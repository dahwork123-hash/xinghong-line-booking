const encoder = new TextEncoder();

function bytesToB64(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

function timingEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyLineSignature(raw, header, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = bytesToB64(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  return timingEqual(sig, header);
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function taipeiNowHm() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .slice(0, 5);
}

function directorFor(schedule, officeId, isoDay, start, parseSlotTime) {
  const rule =
    (schedule?.rules || []).find((r) => r.officeId === officeId) ||
    (schedule?.rules || []).find((r) => r.officeId === "taichung") ||
    schedule?.rules?.[0] ||
    {};
  const directors = (schedule?.directors || []).filter((d) => d.officeId === (rule.officeId || officeId));
  const assignments = schedule?.assignments || {};
  const times = rule.isoWeekdays?.[isoDay] || rule.isoWeekdays?.[String(isoDay)] || [];
  const time = times.find((t) => parseSlotTime(t)?.start === start);
  const resolvedOffice = rule.officeId || officeId || "taichung";
  const pool = rule.pool || "general";
  const key = resolvedOffice + "|" + pool + "|" + isoDay + "|" + start;
  const id = assignments[key] || directors[0]?.id || "";
  const d = (schedule?.directors || []).find((x) => x.id === id) || directors[0];
  return {
    id: d?.id || "",
    label: d ? [d.unit, d.name].filter(Boolean).join(" ") : "",
    capacity: Number(rule.capacity) || 5,
    end: parseSlotTime(time)?.end,
  };
}

async function lineReply(token, replyToken, text) {
  if (!replyToken || !text) return;
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: String(text).slice(0, 4900) }],
    }),
  });
}

async function linePush(token, userId, text) {
  if (!userId || !text) return false;
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text: String(text).slice(0, 4900) }],
    }),
  });
  return res.ok;
}

async function lineName(token, userId) {
  const res = await fetch("https://api.line.me/v2/bot/profile/" + userId, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok) return "";
  const data = await res.json();
  return String(data.displayName || "");
}

const lastCityByUser = new Map();

async function applyActions(sb, schedule, userId, displayName, result, parseSlotTime) {
  let booked = null;
  for (const action of result.actions || []) {
    if (action.type === "human") {
      await sb.rpc("xinghong_set_line_mode", {
        p_line_user_id: userId,
        p_mode: "human",
        p_line_name: displayName,
      });
    }
    if (action.type === "cancel") {
      await sb.rpc("xinghong_cancel_by_line", { p_line_user_id: userId });
    }
    if (action.type === "touch") {
      if (action.city) lastCityByUser.set(userId, action.city);
      const payload = {
        p_line_user_id: userId,
        p_line_name: displayName,
      };
      if (action.job) payload.p_job = action.job;
      if (action.city) payload.p_apply_city = action.city;
      if (action.phone) payload.p_phone = action.phone;
      if (action.name) payload.p_name = action.name;
      if (action.jobPicked) payload.p_job_picked = true;
      const { error } = await sb.rpc("xinghong_touch_line", payload);
      if (error) console.error("xinghong_touch_line", action, error);
    }
    if (action.type === "pending") {
      const { error } = await sb.rpc("xinghong_touch_line", {
        p_line_user_id: userId,
        p_line_name: displayName,
        p_pending: action.picked,
      });
      if (error) console.error("xinghong_touch_line pending", error);
    }
    if (action.type === "clear_pending") {
      await sb.rpc("xinghong_touch_line", {
        p_line_user_id: userId,
        p_line_name: displayName,
        p_clear_pending: true,
      });
    }
    if (action.type === "book") {
      const picked = action.picked;
      const meta = directorFor(schedule, picked.officeId || "taichung", picked.isoDay, picked.start, parseSlotTime);
      const { data, error } = await sb.rpc("xinghong_line_book", {
        p_line_user_id: userId,
        p_line_name: displayName,
        p_date: picked.date,
        p_start: picked.start,
        p_end: picked.end || meta.end,
        p_director_id: meta.id,
        p_director_label: meta.label,
        p_capacity: meta.capacity,
      });
      if (error) {
        const msg = String(error.message || error);
        if (msg.includes("SLOT_FULL")) {
          result.text = "這個時段的線上預約名額已滿，請選其他方便的時段，謝謝您！";
        } else {
          result.text = "這個時段現在無法預約，請改選其他時間，或回「聯絡同仁」。";
        }
      } else {
        booked = { id: data?.id, picked, meta };
      }
    }
  }
  return booked;
}

async function loadBoard(sb, userId) {
  const { data: board } = await sb.rpc("xinghong_board");
  const schedule = board?.schedule || {};
  const candidate = (board?.candidates || []).find((c) => c.line_user_id === userId);
  const current = (board?.bookings || []).find((b) => b.candidate_id === candidate?.id);
  return { schedule, candidate, current, board };
}

async function rememberCity(sb, userId, displayName, city) {
  if (!city) return;
  lastCityByUser.set(userId, city);
  const { error } = await sb.rpc("xinghong_touch_line", {
    p_line_user_id: userId,
    p_line_name: displayName || "",
    p_apply_city: city,
  });
  if (error) console.error("xinghong_touch_line city", city, error);
}

async function notifyDirectorBooked(token, sb, chat, schedule, booked, candidate) {
  if (!booked?.meta?.id) return;
  const director = chat.directorById(schedule, booked.meta.id);
  if (!director?.notifyLine) return;
  const city = candidate?.apply_city || booked.picked?.city || "台中";
  const office = chat.applyOfficeDetails(chat.officeForCity(city), schedule);
  const text = chat.composeDirectorNotice(
    "booked",
    {
      name: candidate?.name,
      phone: candidate?.phone,
      job: candidate?.job,
      apply_city: city,
      interview_date: booked.picked.date,
      start_time: booked.picked.start,
      director_label: director.unit ? [director.unit, director.name].filter(Boolean).join(" ") : director.name,
    },
    office,
  );
  const ok = await linePush(token, director.notifyLine, text);
  if (ok && booked.id) {
    await sb.rpc("xinghong_mark_director_notice", { p_booking_id: booked.id, p_kind: "booked" });
  }
}

async function handleBind(sb, token, replyToken, userId, displayName, bind) {
  if (bind.kind === "unbind") {
    await sb.rpc("xinghong_unbind_director", { p_line_user_id: userId });
    await lineReply(token, replyToken, "已解除主管 LINE 綁定。之後新的面試預約不會再通知這個帳號。");
    return;
  }
  const { data, error } = await sb.rpc("xinghong_bind_director", {
    p_code: bind.code,
    p_line_user_id: userId,
    p_line_name: displayName || "",
  });
  if (error) {
    const msg = String(error.message || error);
    const text = msg.includes("CODE_NOT_FOUND")
      ? "找不到這個綁定碼。請向招募同仁確認六碼，或請他們重新產生。"
      : "綁定沒有成功，請稍後再試，或回「聯絡同仁」。";
    await lineReply(token, replyToken, text);
    return;
  }
  const label = data?.label ? "「" + data.label + "」" : "這位主管";
  await lineReply(
    token,
    replyToken,
    "已綁定為" + label + "。之後有面試者約到您的時段，會立刻通知您；面試前一天與前兩小時也會再提醒一次。",
  );
}

async function handleEvents(token, events) {
  const [{ createClient }, chat] = await Promise.all([
    import("npm:@supabase/supabase-js@2"),
    import("./chat-offer.js"),
  ]);
  const {
    buildLineReply,
    parseSlotTime,
    classifyLineText,
    classifyBindText,
  } = chat;
  const sb = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  for (const event of events) {
    const userId = event.source?.userId;
    const replyToken = event.replyToken;
    if (!userId) continue;
    if (event.type === "follow") continue;
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const text = event.message.text || "";
    const displayName = await lineName(token, userId);
    const bind = classifyBindText(text);
    if (bind) {
      await handleBind(sb, token, replyToken, userId, displayName, bind);
      continue;
    }
    const intent = classifyLineText(text);
    if (intent.kind === "city") {
      await rememberCity(sb, userId, displayName, intent.value);
    }
    let { schedule, candidate, current } = await loadBoard(sb, userId);
    if (intent.kind === "chat" && !lastCityByUser.get(userId)) {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        ({ schedule, candidate, current } = await loadBoard(sb, userId));
        if (candidate?.apply_city) break;
      }
    }
    const applyCity = lastCityByUser.get(userId) || candidate?.apply_city || "";
    const result = buildLineReply({
      text,
      today: taipeiToday(),
      nowHm: taipeiNowHm(),
      schedule,
      applyCity,
      booking: current || null,
      humanMode: candidate?.line_mode === "human",
      profile: {
        name: candidate?.name,
        phone: candidate?.phone,
        job: candidate?.job,
        namePicked: Boolean(candidate?.line_name_picked),
        jobPicked: Boolean(candidate?.line_job_picked),
        profileOk: Boolean(candidate?.line_profile_ok),
      },
      pending: candidate?.line_pending || null,
    });
    if (result.silent) continue;
    const booked = await applyActions(sb, schedule, userId, displayName, result, parseSlotTime);
    if (booked) {
      const fresh = await loadBoard(sb, userId);
      await notifyDirectorBooked(token, sb, chat, fresh.schedule || schedule, booked, fresh.candidate || candidate);
    }
    await lineReply(token, replyToken, result.text);
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("LINE_CHANNEL_SECRET") || "";
  const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
  if (req.method === "GET") {
    const ready = Boolean(secret && token);
    return new Response(ready ? "xinghong line webhook ready" : "xinghong line webhook (secrets missing)", {
      status: ready ? 200 : 503,
    });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!secret || !token) return new Response("LINE secrets missing", { status: 503 });

  const raw = await req.text();
  const header = req.headers.get("x-line-signature") || "";
  if (!(await verifyLineSignature(raw, header, secret))) {
    return new Response("unauthorized", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const events = body.events || [];
  if (events.length) EdgeRuntime.waitUntil(handleEvents(token, events));
  return new Response("ok");
});
