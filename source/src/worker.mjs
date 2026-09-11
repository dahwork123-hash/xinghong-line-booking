import { Store } from "./store.mjs";
import {
  AppError,
  invariant,
  messages,
  id,
  seed,
  localDate,
} from "./domain.mjs";
import {
  adminIdentity,
  checkOrigin,
  readJson,
  rateLimit,
  securityHeaders,
  localMode,
} from "./security.mjs";
import { handleWebhook, processVerifiedEvents } from "./line.mjs";
import { exportBookings } from "./export.mjs";

const json = (data, status = 200) => Response.json(data, { status });
function filterFrom(url) {
  return Object.fromEntries(
    [
      "from",
      "to",
      "office",
      "pool",
      "job",
      "status",
      "search",
      "sessionId",
      "applyCity",
    ].map((k) => [k, url.searchParams.get(k) || ""]),
  );
}
async function admin(request, env, store, url) {
  const identity = await adminIdentity(request, env),
    actor = identity.email;
  checkOrigin(request, env);
  await rateLimit(store, "admin:" + identity.id, 180);
  const path = url.pathname.slice("/api/admin".length),
    method = request.method;
  if (method === "GET" && path === "/me")
    return json({
      identity,
      environment: env.APP_ENV,
      launchApproved: env.LAUNCH_APPROVED === "true",
      countScope: seed.rules.countScopeLabel,
      jobs: seed.jobs,
      offices: seed.offices,
      cities: seed.applicationCities,
      sources: seed.sources,
      today: localDate(store.clock()),
      serverTime: store.clock(),
      directors: (await store.setting("staff")).value.directors,
    });
  if (method === "GET" && path === "/sessions")
    return json({
      sessions: await store.listSessions(
        url.searchParams.get("from") || undefined,
        url.searchParams.get("to") || undefined,
      ),
    });
  if (method === "GET" && path === "/available") {
    const j = seed.jobs.find((j) => j.id === url.searchParams.get("jobId"));
    invariant(j, "INVALID_JOB");
    return json({
      sessions: await store.available(
        url.searchParams.get("officeId"),
        j.pool,
        url.searchParams.get("excludeBookingId"),
      ),
    });
  }
  if (method === "GET" && path === "/bookings") {
    const rows = await store.listBookings(filterFrom(url));
    invariant(rows.length <= 1000, "EXPORT_TOO_LARGE", 413);
    return json({
      bookings: rows,
      total: rows.length,
      countScope: seed.rules.countScopeLabel,
    });
  }
  if (method === "GET" && path === "/export.xlsx") {
    const filter = filterFrom(url),
      rows = await store.listBookings(filter),
      body = await exportBookings(rows, filter, actor);
    await store.audit(actor, "export", "bookings", {
      filter: { ...filter, search: undefined, searchUsed: !!filter.search },
      count: rows.length,
    });
    return new Response(body, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="interview-bookings.xlsx"',
      },
    });
  }
  if (method === "GET" && path === "/candidates") {
    const offset = Number(url.searchParams.get("offset") || 0),
      list = await store.modeList(offset);
    return json({
      candidates: list.slice(0, 200),
      nextOffset: list.length > 200 ? offset + 200 : null,
    });
  }
  const candidateMatch = path.match(/^\/candidates\/([a-f0-9-]{36})$/);
  if (method === "GET" && candidateMatch) {
    const conversation = await store.conversation(candidateMatch[1]);
    return json({
      candidateId: candidateMatch[1],
      conversation,
      active: await store.active(candidateMatch[1]),
    });
  }
  const bookingMatch = path.match(/^\/bookings\/([a-f0-9-]{36})$/);
  if (method === "GET" && bookingMatch) {
    const booking = await store.booking(bookingMatch[1]),
      events = await store.all(
        "SELECT * FROM booking_events WHERE booking_id=? ORDER BY at,id",
        booking.id,
      );
    return json({ booking, events });
  }
  if (method === "GET" && path === "/settings")
    return json({
      schedules: await store.setting("schedules"),
      templates: await store.setting("templates"),
      staff: await store.setting("staff"),
      templateDefinitions: seed.templates,
    });
  if (method === "GET" && path === "/audit")
    return json({
      audit: await store.all(
        "SELECT * FROM audit_events ORDER BY id DESC LIMIT 200",
      ),
      delivery: await store.all(
        "SELECT id,candidate_id,delivery_status,updated_at FROM webhook_events WHERE delivery_status NOT IN ('none','sent','suppressed') ORDER BY updated_at DESC LIMIT 100",
      ),
    });
  if (method === "GET" && path === "/retention")
    return json(await store.retention(true, actor));
  if (method !== "POST") throw new AppError("NOT_FOUND", 404);
  const input = await readJson(request, 65536);
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "INVALID_INPUT",
  );
  if (path === "/bookings") {
    const cid = input.candidateId;
    await store.conversation(cid);
    invariant(input.confirm === true, "CONFIRM_REQUIRED");
    return json(
      await store.withLock("candidate:" + cid, (lock) =>
        store.mutateBooking(
          {
            candidateId: cid,
            sessionId: input.sessionId,
            profile: input.profile,
            key: request.headers.get("Idempotency-Key"),
            actor,
            actorKind: "admin",
          },
          lock,
        ),
      ),
    );
  }
  const change = path.match(
    /^\/bookings\/([a-f0-9-]{36})\/(reschedule|cancel)$/,
  );
  if (change) {
    const b = await store.booking(change[1]);
    invariant(input.confirm === true, "CONFIRM_REQUIRED");
    return json(
      await store.withLock("candidate:" + b.candidate_id, (lock) =>
        store.mutateBooking(
          {
            candidateId: b.candidate_id,
            bookingId: b.id,
            revision: input.revision,
            sessionId: input.sessionId,
            profile: input.profile,
            cancel: change[2] === "cancel",
            key: request.headers.get("Idempotency-Key"),
            actor,
            actorKind: "admin",
          },
          lock,
        ),
      ),
    );
  }
  const mode = path.match(/^\/candidates\/([a-f0-9-]{36})\/(handoff|resume)$/);
  if (mode) {
    await store.conversation(mode[1]);
    return json(
      await store.withLock("candidate:" + mode[1], (lock) =>
        store.setMode(
          mode[1],
          mode[2] === "handoff" ? "human" : "auto",
          actor,
          lock,
        ),
      ),
    );
  }
  const session = path.match(/^\/sessions\/([a-zA-Z0-9_-]+)$/);
  if (session)
    return json({
      affected: await store.sessionChange(
        session[1],
        input.revision,
        input,
        actor,
      ),
    });
  if (path === "/sessions") return json(await store.addSession(input, actor));
  if (path === "/schedules/preview")
    return json(await store.schedulePreview(input));
  if (path === "/schedules/draft") {
    await store.saveScheduleDraft(input, actor);
    return json({ saved: true });
  }
  if (path === "/schedules/publish") {
    invariant(input.confirm === true, "CONFIRM_REQUIRED");
    return json(await store.publishSchedule(input, actor));
  }
  if (path === "/staff") {
    return json(await store.saveStaff(input, actor));
  }
  const template = path.match(/^\/templates\/([a-z_]+)\/(draft|publish)$/);
  if (template) {
    if (template[2] === "draft") {
      await store.templateDraft(template[1], input.text, actor, input.revision);
      return json({ saved: true });
    }
    invariant(input.confirm === true, "CONFIRM_REQUIRED");
    return json(
      await store.publishTemplate(
        template[1],
        input.text,
        actor,
        input.revision,
      ),
    );
  }
  if (path === "/retention/purge") {
    invariant(
      input.confirm === true && input.date === localDate(store.clock()),
      "CONFIRM_REQUIRED",
    );
    return json(await store.retention(false, actor));
  }
  throw new AppError("NOT_FOUND", 404);
}

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        await processVerifiedEvents(
          [msg.body.event],
          env,
          new Store(env.DB, env.CLOCK),
          msg.body.receivedAt,
        );
        msg.ack();
      } catch {
        console.error(
          JSON.stringify({
            event: "queue_retry",
            messageId: msg.id,
            attempt: msg.attempts,
          }),
        );
        msg.retry({ delaySeconds: 5 });
      }
    }
  },
  async scheduled(controller, env, ctx) {
    if (env.RETENTION_ENABLED !== "true") return;
    ctx.waitUntil(new Store(env.DB).retention(false, "scheduled-maintenance"));
  },
  async fetch(request, env) {
    const requestId = id();
    let response;
    try {
      const url = new URL(request.url);
      invariant(env.DB && env.PUBLIC_ORIGIN, "SERVICE_NOT_READY", 503);
      invariant(url.origin === env.PUBLIC_ORIGIN, "FORBIDDEN", 403);
      invariant(
        url.protocol === "https:" || localMode(env, url),
        "FORBIDDEN",
        403,
      );
      const store = new Store(env.DB, env.CLOCK);
      if (request.method === "GET" && url.pathname === "/health")
        response = json({ ok: true, version: "0.1.0-rc.1" });
      else if (request.method === "POST" && url.pathname === "/webhooks/line")
        response = await handleWebhook(request, env, store);
      else if (url.pathname.startsWith("/api/admin/"))
        response = await admin(request, env, store, url);
      else if (
        request.method === "GET" &&
        ["/", "/index.html", "/app.js", "/style.css"].includes(url.pathname)
      ) {
        response = await env.ASSETS.fetch(request);
      } else response = json({ error: "NOT_FOUND" }, 404);
    } catch (e) {
      const known = e instanceof AppError;
      response = json(
        {
          error: known ? e.code : "INTERNAL_ERROR",
          message: known
            ? messages[e.code] || "操作未完成，請重新查詢或聯絡維護人員。"
            : "系統暫時無法處理，請稍後重試。",
          requestId,
        },
        known ? e.status : 500,
      );
      if (!known)
        console.error(
          JSON.stringify({
            event: "request_failed",
            requestId,
            code: "INTERNAL_ERROR",
          }),
        );
    }
    const safe = securityHeaders(response);
    safe.headers.set("X-Request-Id", requestId);
    return safe;
  },
};
