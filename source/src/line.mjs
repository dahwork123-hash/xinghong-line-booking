import {
  seed,
  id,
  jobLabel,
  poolFor,
  dateLabel,
  formatSlotRange,
  validateProfile,
  parseLegacy,
  AppError,
  invariant,
  messages,
  sha,
  canonical,
} from "./domain.mjs";
import { readBody, verifyLineSignature, rateLimit } from "./security.mjs";

const textMessage = (text) => ({
  type: "text",
  text: String(text).slice(0, 4900),
});
function snapshotText(b) {
  const s = b.snapshot;
  return `預約編號：${b.id}\n職務：${jobLabel(b.job_id)}\n姓名：${b.name}\n電話：${b.phone}\n應徵縣市：${b.apply_city}\n面試日期：${dateLabel(s.date)} ${formatSlotRange(s.time)}\n面試地點：${s.address}${s.interviewer ? "\n面試主管：" + s.interviewer : ""}`;
}
function fillTemplate(text, values) {
  return text.replace(/{{([^}]+)}}/g, (_, k) => String(values[k] ?? ""));
}
export async function processConversation(store, cid, event, lock, env) {
  let state = await store.conversation(cid);
  if (event.timestamp < state.last_event_timestamp) {
    await store.run(
      "UPDATE webhook_events SET status='done',delivery_status='out_of_order',response=NULL WHERE id=?",
      event.webhookEventId,
    );
    return;
  }
  const initialMode = state.mode;
  if (initialMode !== "auto") {
    await store.run(
      "UPDATE webhook_events SET status='done',response=NULL,delivery_status='suppressed',updated_at=? WHERE id=?",
      store.clock(),
      event.webhookEventId,
    );
    return;
  }
  let next = { step: state.step, data: structuredClone(state.data) },
    buttons = [],
    output = "",
    ackHuman = false;
  const configs = (await store.setting("templates")).value;
  const choice = (label, kind, payload = {}) => {
    const b = { label, kind, payload, token: id() };
    buttons.push(b);
    return b;
  };
  const homeButtons = () => {
    choice("預約面試", "start");
    choice("我的預約", "mine");
    choice("常見問題", "faq");
    choice("聯絡同仁", "human");
  };
  const active = await store.active(cid);
  async function screen() {
    buttons = [];
    const d = next.data;
    if (next.step === "home") {
      output = "您好，請選擇下方功能，我們會協助您安排面試。";
      homeButtons();
    } else if (next.step === "job") {
      output = "請選擇您想應徵的職務。";
      for (const j of seed.jobs) choice(j.label, "job", { jobId: j.id });
    } else if (next.step === "city") {
      output =
        "請選擇應徵縣市。" +
        (d.jobId === "admin" ? "行政面試統一在台中文心路，主管 TOBY。" : "");
      for (const city of seed.applicationCities) choice(city, "city", { city });
    } else if (next.step === "office") {
      output = configs.nantou_route.text;
      choice("台中分公司", "office", { officeId: "taichung" });
      choice("彰化分公司", "office", { officeId: "changhua" });
    } else if (next.step === "admin-office") {
      output = "行政職面試統一在台中文心路，請問您方便前往嗎？";
      choice("方便，繼續預約", "office", { officeId: "taichung" });
      choice("聯絡同仁", "human");
    } else if (next.step === "name") {
      output =
        env.PRIVACY_NOTICE +
        "\n\n請輸入姓名。只需要姓名、電話、職務與應徵縣市。";
      if (d.name) choice("沿用：" + d.name.slice(0, 12), "keep-name");
    } else if (next.step === "phone") {
      output = "請輸入方便聯絡的電話。";
      if (d.phone) choice("沿用電話", "keep-phone");
    } else if (next.step === "source") {
      output = "您從哪裡知道這個職缺呢？來源可以略過。";
      for (const source of seed.sources)
        choice(source === "未知" ? "略過" : source, "source", { source });
    } else if (next.step === "date") {
      const slots = (
        await store.available(d.officeId, poolFor(d.jobId), d.bookingId || null)
      ).filter((s) => s.remaining > 0);
      const dates = [...new Set(slots.map((s) => s.local_date))],
        page = Math.max(0, d.datePage || 0);
      output =
        (d.bookingId ? configs.reschedule_offer.text + "\n" : "") +
        configs.choose_slot.text +
        "\n開放含今天14日，每場提前1小時截止。\n" +
        configs.weather_notice.text;
      for (const date of dates.slice(page * 10, page * 10 + 10))
        choice(dateLabel(date), "date", { date });
      if (page > 0) choice("上一頁", "date-page", { page: page - 1 });
      if (dates.length > (page + 1) * 10)
        choice("下一頁", "date-page", { page: page + 1 });
      if (!dates.length) {
        output = "目前沒有可預約的場次，請聯絡招募同仁。";
        choice("聯絡同仁", "human");
      }
      choice("返回選單", "home");
    } else if (next.step === "time") {
      const slots = (
          await store.available(
            d.officeId,
            poolFor(d.jobId),
            d.bookingId || null,
          )
        ).filter((s) => s.local_date === d.date && s.remaining > 0),
        page = Math.max(0, d.timePage || 0);
      output = dateLabel(d.date) + "，請選擇時間。";
      for (const s of slots.slice(page * 10, page * 10 + 10))
        choice(formatSlotRange(s.local_time), "time", { sessionId: s.id });
      if (page > 0) choice("上一頁", "time-page", { page: page - 1 });
      if (slots.length > (page + 1) * 10)
        choice("下一頁", "time-page", { page: page + 1 });
      if (!slots.length) output = "這天已無可預約名額，請重新選擇日期。";
      choice("重選日期", "dates");
    } else if (next.step === "review") {
      const s = await store.first(
        "SELECT * FROM sessions WHERE id=?",
        d.sessionId,
      );
      invariant(s, "INVALID_ACTION");
      output = `請核對面試資訊：\n${d.name}／${d.phone}\n職務：${jobLabel(d.jobId)}\n應徵縣市：${d.applyCity}\n面試：${dateLabel(s.local_date)} ${formatSlotRange(s.local_time)}\n地點：${s.address}${s.interviewer ? "\n主管：" + s.interviewer : ""}\n\n最後確認後才成立預約。`;
      choice(d.bookingId ? "確認改期" : "確認預約", "confirm", {
        sessionId: d.sessionId,
        bookingId: d.bookingId || null,
        revision: d.bookingRevision || null,
      });
      choice("重選日期", "dates");
      choice("修改資料／職缺", "edit-profile");
    } else if (next.step === "booking") {
      const b = await store.active(cid);
      if (!b) {
        output = "目前沒有尚未開始的有效預約。";
        homeButtons();
      } else {
        output = snapshotText({ ...b, snapshot: JSON.parse(b.snapshot) });
        choice("修改預約", "reschedule", {
          bookingId: b.id,
          revision: b.revision,
        });
        choice("取消預約", "cancel-review", {
          bookingId: b.id,
          revision: b.revision,
        });
        choice("聯絡同仁", "human");
      }
    } else if (next.step === "cancel-review") {
      const b = await store.booking(d.cancelId);
      invariant(b.candidate_id === cid, "FORBIDDEN", 403);
      output = "確定要取消以下預約嗎？\n" + snapshotText(b);
      choice("保留預約", "mine");
      choice("確認取消", "cancel", { bookingId: b.id, revision: b.revision });
    } else if (next.step === "faq") {
      output = "請選擇想了解的內容。";
      choice("工作內容", "faq-answer", { key: "work_general" });
      choice("薪資與工時", "faq-answer", { key: "salary_general" });
      choice("台中辦公室", "faq-answer", { key: "office_taichung" });
      choice("南投辦公室", "faq-answer", { key: "office_nantou" });
      choice("回到預約", "continue");
    }
  }
  async function human() {
    await store.setMode(cid, "pending_human", "line:" + cid, lock);
    ackHuman = true;
    output = configs.human.text + "\n協助編號：" + cid.slice(0, 8);
    buttons = [];
    next.step = "home";
  }
  async function start() {
    if (active) {
      next.step = "booking";
    } else {
      next = { step: "job", data: {} };
    }
    await screen();
  }
  try {
    let action = null;
    if (event.type === "postback") {
      invariant(event.postback?.data?.startsWith("a:"), "INVALID_ACTION");
      action = await store.resolveAction(
        event.postback.data.slice(2),
        cid,
        state.revision,
      );
    } else if (event.type === "message" && event.message?.type === "text") {
      const text = event.message.text.trim();
      invariant(text.length <= 5000, "INVALID_INPUT");
      if (["預約", "預約面試", "開始預約"].includes(text))
        action = { kind: "start", payload: {} };
      else if (["我的預約", "查詢預約"].includes(text))
        action = { kind: "mine", payload: {} };
      else if (["人工", "聯絡同仁", "聯絡招募人員"].includes(text))
        action = { kind: "human", payload: {} };
      else if (["工作內容", "薪資", "上班時間", "底薪"].includes(text))
        action = {
          kind: "faq-answer",
          payload: {
            key: text === "工作內容" ? "work_general" : "salary_general",
          },
        };
      else if (["常見問題", "FAQ"].includes(text))
        action = { kind: "faq", payload: {} };
      else if (["取消預約", "不能來了", "改期", "約下次"].includes(text))
        action = { kind: "mine", payload: {} };
      else if (text.includes("【")) {
        const p = parseLegacy(text);
        next = {
          step: p.jobId
            ? p.applyCity
              ? p.jobId === "admin"
                ? "admin-office"
                : p.applyCity === "南投"
                  ? "office"
                  : "name"
              : "city"
            : "job",
          data: p,
        };
        if (p.applyCity !== "南投")
          next.data.officeId =
            p.jobId === "admin"
              ? "taichung"
              : seed.offices.find((o) => o.city === p.applyCity)?.id;
        await screen();
      } else if (state.step === "name") {
        invariant(
          text.length <= 80 && !/[\u0000-\u001f]/.test(text),
          "INVALID_NAME",
        );
        invariant(
          !["星小鴻", "姓名", "範例姓名"].includes(text),
          "EXAMPLE_DATA",
        );
        next.data.name = text;
        next.step = "phone";
        await screen();
      } else if (state.step === "phone") {
        const p = validateProfile({ ...next.data, phone: text });
        next.data = { ...next.data, ...p };
        next.step = "source";
        await screen();
      } else await human();
    } else await human();
    if (action) {
      const { kind, payload: p } = action;
      if (kind === "home") {
        next = { step: "home", data: next.data };
        await screen();
      } else if (kind === "start") await start();
      else if (kind === "mine") {
        next.step = "booking";
        await screen();
      } else if (kind === "job") {
        invariant(
          seed.jobs.some((j) => j.id === p.jobId),
          "INVALID_ACTION",
        );
        next.data.jobId = p.jobId;
        next.step = "city";
        await screen();
      } else if (kind === "city") {
        invariant(seed.applicationCities.includes(p.city), "INVALID_ACTION");
        next.data.applyCity = p.city;
        next.step =
          next.data.jobId === "admin"
            ? "admin-office"
            : p.city === "南投"
              ? "office"
              : "name";
        next.data.officeId =
          next.data.jobId === "admin"
            ? "taichung"
            : seed.offices.find((o) => o.city === p.city)?.id;
        await screen();
      } else if (kind === "office") {
        next.data.officeId = p.officeId;
        next.step = "name";
        await screen();
      } else if (kind === "keep-name") {
        invariant(next.data.name, "INVALID_ACTION");
        next.step = "phone";
        await screen();
      } else if (kind === "keep-phone") {
        validateProfile(next.data);
        next.step = "source";
        await screen();
      } else if (kind === "source") {
        next.data.source = p.source;
        validateProfile(next.data);
        next.step = "date";
        await screen();
      } else if (kind === "date-page") {
        next.data.datePage = p.page;
        next.step = "date";
        await screen();
      } else if (kind === "date") {
        next.data.date = p.date;
        next.data.timePage = 0;
        next.step = "time";
        await screen();
      } else if (kind === "time-page") {
        next.data.timePage = p.page;
        next.step = "time";
        await screen();
      } else if (kind === "dates") {
        next.step = "date";
        await screen();
      } else if (kind === "time") {
        next.data.sessionId = p.sessionId;
        next.step = "review";
        await screen();
      } else if (kind === "edit-profile") {
        next.step = "job";
        await screen();
      } else if (kind === "confirm") {
        const b = await store.mutateBooking(
          {
            candidateId: cid,
            sessionId: p.sessionId,
            profile: next.data,
            bookingId: p.bookingId,
            revision: p.revision,
            key: "line-" + event.webhookEventId,
            actor: "line:" + cid,
            actorKind: "line",
          },
          lock,
        );
        const s = b.snapshot;
        output = fillTemplate(configs.booking_success.text, {
          bookingId: b.id,
          job: jobLabel(b.job_id),
          date: dateLabel(s.date),
          time: formatSlotRange(s.time),
          address: s.address,
          arrival: s.arrival,
          interviewerNote: s.interviewer ? "面試主管：" + s.interviewer : "",
        });
        next = { step: "booking", data: { jobId: b.job_id } };
        choice("我的預約", "mine");
        choice("聯絡同仁", "human");
      } else if (kind === "reschedule") {
        const b = await store.booking(p.bookingId);
        invariant(
          b.candidate_id === cid && b.revision === p.revision,
          "INVALID_ACTION",
        );
        next = {
          step: "date",
          data: {
            name: b.name,
            phone: b.phone,
            jobId: b.job_id,
            applyCity: b.apply_city,
            source: b.source,
            officeId: b.office_id,
            bookingId: b.id,
            bookingRevision: b.revision,
          },
        };
        await screen();
      } else if (kind === "cancel-review") {
        next.data.cancelId = p.bookingId;
        next.step = "cancel-review";
        await screen();
      } else if (kind === "cancel") {
        await store.mutateBooking(
          {
            candidateId: cid,
            bookingId: p.bookingId,
            revision: p.revision,
            cancel: true,
            key: "line-" + event.webhookEventId,
            actor: "line:" + cid,
            actorKind: "line",
          },
          lock,
        );
        output = "已取消預約，名額已釋出。之後方便時可以再預約，謝謝您。";
        next = { step: "home", data: {} };
        homeButtons();
      } else if (kind === "human") await human();
      else if (kind === "faq") {
        next.data.returnStep = next.step;
        next.step = "faq";
        await screen();
      } else if (kind === "faq-answer") {
        invariant(
          [
            "work_general",
            "salary_general",
            "office_taichung",
            "office_nantou",
          ].includes(p.key),
          "INVALID_ACTION",
        );
        if (
          next.data.jobId === "admin" ||
          active?.job_id === "admin" ||
          (!next.data.jobId &&
            !active &&
            ["work_general", "salary_general"].includes(p.key))
        )
          await human();
        else {
          output = configs[p.key].text;
          choice("回到預約", "continue");
          choice("聯絡同仁", "human");
        }
      } else if (kind === "continue") {
        next.step = next.data.returnStep || next.step;
        if (["faq", "home", "booking"].includes(next.step))
          next.step = active ? "booking" : "home";
        await screen();
      } else throw new AppError("INVALID_ACTION");
    }
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (["HUMAN_HANDOFF", "BUSY"].includes(e.code)) throw e;
    const key = { SLOT_FULL: "full", CUTOFF_PASSED: "cutoff" }[e.code];
    output = key
      ? configs[key].text
      : messages[e.code] || "資料需要重新確認，請從選單操作或聯絡同仁。";
    if (["INVALID_NAME", "INVALID_PHONE"].includes(e.code))
      output = fillTemplate(configs.missing_field.text, {
        field: e.code === "INVALID_NAME" ? "姓名" : "電話",
      });
    buttons = [];
    homeButtons();
  }
  invariant(output, "PERSISTENCE_FAILED", 503);
  invariant(buttons.length <= 13, "PERSISTENCE_FAILED", 503);
  const response = textMessage(output);
  if (buttons.length)
    response.quickReply = {
      items: buttons.map((b) => ({
        type: "action",
        action: {
          type: "postback",
          label: b.label.slice(0, 20),
          data: "a:" + b.token,
          displayText: b.label.slice(0, 100),
        },
      })),
    };
  await store.saveConversation(
    cid,
    state,
    { ...next, eventTimestamp: event.timestamp },
    buttons,
    event.webhookEventId,
    [response],
    ackHuman,
    lock,
  );
}
export async function handleWebhook(request, env, store) {
  invariant(
    env.LINE_CHANNEL_SECRET &&
      env.LINE_CHANNEL_ACCESS_TOKEN &&
      env.LINE_DESTINATION_ID,
    "SERVICE_NOT_READY",
    503,
  );
  const bytes = await readBody(request, 1048576);
  invariant(
    await verifyLineSignature(
      bytes,
      request.headers.get("x-line-signature"),
      env.LINE_CHANNEL_SECRET,
    ),
    "INVALID_SIGNATURE",
    401,
  );
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError("INVALID_JSON", 400);
  }
  invariant(
    body.destination === env.LINE_DESTINATION_ID &&
      Array.isArray(body.events) &&
      body.events.length <= 100,
    "INVALID_INPUT",
  );
  if (body.events.length === 0) return new Response("OK");
  invariant(
    env.LAUNCH_APPROVED === "true" && env.PRIVACY_NOTICE,
    "SERVICE_NOT_READY",
    503,
  );
  const events = body.events
    .filter(
      (e) =>
        ["message", "postback"].includes(e.type) && e.source?.type === "user",
    )
    .map((e) => {
      invariant(
        Number.isSafeInteger(e.timestamp) &&
          e.timestamp > 0 &&
          e.timestamp <= store.clock() * 1000 + 60000,
        "INVALID_INPUT",
      );
      invariant(
        /^U[a-f0-9]{32}$/i.test(e.source.userId || "") &&
          typeof e.webhookEventId === "string" &&
          e.webhookEventId.length > 0 &&
          e.webhookEventId.length <= 100,
        "INVALID_INPUT",
      );
      if (e.type === "message" && e.message?.type === "text")
        invariant(
          typeof e.message.text === "string" && e.message.text.length <= 5000,
          "INVALID_INPUT",
        );
      return {
        type: e.type,
        timestamp: e.timestamp,
        webhookEventId: e.webhookEventId,
        source: { type: "user", userId: e.source.userId },
        replyToken: e.replyToken || "",
        ...(e.type === "postback"
          ? { postback: { data: String(e.postback?.data || "").slice(0, 200) } }
          : {
              message: {
                id: e.message?.id || "",
                type: e.message?.type || "unknown",
                ...(e.message?.type === "text" ? { text: e.message.text } : {}),
              },
            }),
      };
    });
  if (!events.length) return new Response("OK");
  if (env.LINE_EVENTS) {
    let messages = [],
      size = 0;
    for (const event of events) {
      const payload = { event, receivedAt: store.clock() },
        length = new TextEncoder().encode(JSON.stringify(payload)).length;
      if (
        messages.length &&
        (size + length > 120000 || messages.length >= 100)
      ) {
        await env.LINE_EVENTS.sendBatch(messages);
        messages = [];
        size = 0;
      }
      messages.push({ body: payload, contentType: "json" });
      size += length;
    }
    if (messages.length) await env.LINE_EVENTS.sendBatch(messages);
  } else {
    // Only an in-process test can inject a function-valued LINE_FETCH binding.
    invariant(typeof env.LINE_FETCH === "function", "SERVICE_NOT_READY", 503);
    await processVerifiedEvents(events, env, store);
  }
  return new Response("OK");
}

export async function processVerifiedEvents(
  events,
  env,
  store,
  receivedAt = store.clock(),
) {
  invariant(
    env.LAUNCH_APPROVED === "true" && env.PRIVACY_NOTICE,
    "SERVICE_NOT_READY",
    503,
  );
  for (const event of events) {
    if (
      !["message", "postback"].includes(event.type) ||
      event.source?.type !== "user"
    )
      continue;
    invariant(
      Number.isSafeInteger(event.timestamp) &&
        event.timestamp > 0 &&
        event.timestamp <= store.clock() * 1000 + 60000,
      "INVALID_INPUT",
    );
    invariant(
      /^U[a-f0-9]{32}$/i.test(event.source.userId || "") &&
        typeof event.webhookEventId === "string" &&
        event.webhookEventId.length <= 100 &&
        event.webhookEventId.length > 0,
      "INVALID_INPUT",
    );
    const candidate = await store.candidate(event.source.userId),
      cid = candidate.id;
    await store.withLock("candidate:" + cid, async (lock) => {
      const hash = await sha(
        canonical({
          type: event.type,
          userId: event.source.userId,
          message: event.message || null,
          postback: event.postback || null,
          timestamp: event.timestamp,
        }),
      );
      let record = await store.first(
        "SELECT * FROM webhook_events WHERE id=?",
        event.webhookEventId,
      );
      if (record) {
        invariant(
          record.payload_hash === hash && record.candidate_id === cid,
          "INVALID_EVENT_REUSE",
        );
        if (record.status === "done") return;
      } else {
        await rateLimit(store, "line:" + cid, 40);
        await store.run(
          `INSERT INTO webhook_events(id,candidate_id,payload_hash,status,created_at,updated_at,expires_at) VALUES(?,?,?,'received',?,?,?)`,
          event.webhookEventId,
          cid,
          hash,
          store.clock(),
          store.clock(),
          store.clock() + 14 * 86400,
        );
      }
      if (
        (!record || record.status === "received") &&
        store.clock() - receivedAt > 45
      ) {
        await store.setMode(cid, "pending_human", "queue-delay", lock);
        await store.run(
          "UPDATE webhook_events SET status='done',delivery_status='queue_expired',response=NULL WHERE id=?",
          event.webhookEventId,
        );
        return;
      }
      if (!record || record.status === "received")
        await processConversation(store, cid, event, lock, env);
      record = await store.first(
        "SELECT * FROM webhook_events WHERE id=?",
        event.webhookEventId,
      );
      if (record.status === "done") return;
      const current = await store.conversation(cid);
      if (
        current.mode_revision !== record.response_mode_revision ||
        (current.mode !== "auto" && !record.ack_human)
      ) {
        await store.run(
          "UPDATE webhook_events SET status='done',delivery_status='suppressed',response=NULL WHERE id=?",
          event.webhookEventId,
        );
        return;
      }
      // A reply timeout is an uncertain delivery, not permission to repeat bookings or send Push.
      let delivery = "failed";
      if (
        event.replyToken &&
        event.replyToken !== "00000000000000000000000000000000"
      ) {
        try {
          const fetcher = env.LINE_FETCH || fetch;
          const res = await fetcher(
            "https://api.line.me/v2/bot/message/reply",
            {
              method: "POST",
              headers: {
                Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                replyToken: event.replyToken,
                messages: JSON.parse(record.response),
              }),
              signal: AbortSignal.timeout(6000),
            },
          );
          delivery = res.ok ? "sent" : "http_" + res.status;
        } catch {
          delivery = "uncertain";
        }
      }
      await store.run(
        "UPDATE webhook_events SET status='done',delivery_status=?,updated_at=? WHERE id=?",
        delivery,
        store.clock(),
        event.webhookEventId,
      );
    });
  }
  return new Response("OK");
}
