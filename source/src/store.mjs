import {
  seed,
  epoch,
  id,
  localDate,
  startsAt,
  weekday,
  poolFor,
  retentionDate,
  validateProfile,
  validateDestination,
  validateSchedules,
  validateTemplate,
  validateDirectors,
  validateAssignments,
  interviewerFor,
  defaultAssignments,
  AppError,
  invariant,
  sha,
  canonical,
  safeDate,
} from "./domain.mjs";

export class Store {
  constructor(db, clock = epoch) {
    this.db = db;
    this.clock = clock;
  }
  q(sql, ...params) {
    return this.db.prepare(sql).bind(...params);
  }
  async first(sql, ...params) {
    return this.q(sql, ...params).first();
  }
  async all(sql, ...params) {
    return (await this.q(sql, ...params).all()).results;
  }
  async run(sql, ...params) {
    return this.q(sql, ...params).run();
  }
  guard(sql, ...params) {
    return this.q(
      `INSERT INTO transaction_guards(value) SELECT CASE WHEN ${sql} THEN 1 ELSE 0 END`,
      ...params,
    );
  }
  async batch(statements) {
    try {
      return await this.db.batch([
        ...statements,
        this.q("DELETE FROM transaction_guards"),
      ]);
    } catch (e) {
      const text = String(e?.message) + " " + String(e?.cause?.message);
      const code =
        [
          "HUMAN_HANDOFF",
          "SESSION_CLOSED",
          "CUTOFF_PASSED",
          "OUTSIDE_WINDOW",
          "INVALID_JOB_POOL",
          "ACTIVE_BOOKING_EXISTS",
          "SLOT_FULL",
          "INTERVIEW_STARTED",
          "ALREADY_CANCELLED",
          "STALE_REVISION",
        ].find((c) => text.includes(c)) ||
        (text.includes("stale_revision") ? "STALE_REVISION" : null);
      if (code) throw new AppError(code);
      throw e;
    }
  }
  async initialize() {
    const now = this.clock();
    await this.batch([
      this.q(
        "INSERT OR IGNORE INTO settings(key,value,updated_at,actor) VALUES(?,?,?,?)",
        "schedules",
        JSON.stringify({ current: seed.weeklySchedules, pending: null }),
        now,
        "bootstrap",
      ),
      this.q(
        "INSERT OR IGNORE INTO settings(key,value,updated_at,actor) VALUES(?,?,?,?)",
        "templates",
        JSON.stringify(
          Object.fromEntries(
            seed.templates.map((t) => [t.key, { text: t.text, version: 1 }]),
          ),
        ),
        now,
        "bootstrap",
      ),
      this.q(
        "INSERT OR IGNORE INTO settings(key,value,updated_at,actor) VALUES(?,?,?,?)",
        "staff",
        JSON.stringify({
          directors: seed.directors,
          assignments: defaultAssignments(),
        }),
        now,
        "bootstrap",
      ),
    ]);
  }
  async ensureStaff() {
    await this.run(
      "INSERT OR IGNORE INTO settings(key,value,updated_at,actor) VALUES(?,?,?,?)",
      "staff",
      JSON.stringify({
        directors: seed.directors,
        assignments: defaultAssignments(),
      }),
      this.clock(),
      "bootstrap",
    );
  }
  async setting(key) {
    if (key === "staff") await this.ensureStaff();
    const row = await this.first("SELECT * FROM settings WHERE key=?", key);
    invariant(row, "SERVICE_NOT_READY", 503);
    return {
      ...row,
      value: JSON.parse(row.value),
      draft: row.draft ? JSON.parse(row.draft) : null,
    };
  }
  scheduleFor(config, date) {
    return config.pending && date >= config.pending.effectiveDate
      ? config.pending.rules
      : config.current;
  }
  async ensureSessions() {
    const config = await this.setting("schedules"),
      staff = (await this.setting("staff")).value,
      now = this.clock(),
      values = [];
    for (let i = 0; i < 14; i++) {
      const date = localDate(now + i * 86400);
      for (const r of this.scheduleFor(config.value, date))
        for (const time of r.isoWeekdays[weekday(date)] || []) {
          const office = seed.offices.find((o) => o.id === r.officeId),
            start = startsAt(date, time);
          const sid = `${r.officeId}_${date}_${time.replace(":", "")}_${r.pool}`;
          values.push([
            sid,
            r.officeId,
            r.pool,
            start,
            date,
            time,
            r.capacity,
            office.address +
              (office.landmark ? " (" + office.landmark + ")" : ""),
            office.arrival,
            interviewerFor(
              staff.directors,
              staff.assignments,
              r.officeId,
              r.pool,
              date,
              time,
            ),
            config.revision,
          ]);
        }
    }
    // Nine rows use 99 parameters, below D1's 100-parameter limit.
    const statements = [];
    for (let offset = 0; offset < values.length; offset += 9) {
      const group = values.slice(offset, offset + 9);
      statements.push(
        this.q(
          "INSERT INTO sessions(id,office_id,pool,starts_at,local_date,local_time,capacity,address,arrival,interviewer,config_revision) VALUES " +
            group.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",") +
            " ON CONFLICT(id) DO UPDATE SET interviewer=excluded.interviewer",
          ...group.flat(),
        ),
      );
    }
    if (statements.length)
      await this.batch([
        this.guard(
          "(SELECT revision FROM settings WHERE key=?)=?",
          "schedules",
          config.revision,
        ),
        ...statements,
      ]);
  }
  async candidate(lineId) {
    const now = this.clock(),
      cid = id();
    await this.batch([
      this.q(
        "INSERT INTO candidates(id,line_user_id,created_at,last_seen) VALUES(?,?,?,?) ON CONFLICT(line_user_id) DO UPDATE SET last_seen=excluded.last_seen",
        cid,
        lineId,
        now,
        now,
      ),
      this.q(
        "INSERT OR IGNORE INTO conversations(candidate_id,changed_at,expires_at) SELECT id,?,? FROM candidates WHERE line_user_id=?",
        now,
        now + 86400,
        lineId,
      ),
    ]);
    return this.first("SELECT id FROM candidates WHERE line_user_id=?", lineId);
  }
  async conversation(cid) {
    const row = await this.first(
      "SELECT * FROM conversations WHERE candidate_id=?",
      cid,
    );
    invariant(row, "NOT_FOUND", 404);
    return {
      ...row,
      data: row.expires_at > this.clock() ? JSON.parse(row.data) : {},
      step: row.expires_at > this.clock() ? row.step : "home",
    };
  }
  async withLock(key, fn) {
    const owner = id(),
      now = this.clock();
    const r = await this.run(
      "INSERT INTO locks(key,owner,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE locks.expires_at<=?",
      key,
      owner,
      now + 90,
      now,
    );
    invariant(r.meta.changes === 1, "BUSY", 503);
    try {
      return await fn({ key, owner });
    } finally {
      await this.run("DELETE FROM locks WHERE key=? AND owner=?", key, owner);
    }
  }
  lease(lock) {
    invariant(lock, "BUSY", 503);
    return this.guard(
      "EXISTS(SELECT 1 FROM locks WHERE key=? AND owner=? AND expires_at>?)",
      lock.key,
      lock.owner,
      this.clock(),
    );
  }
  async audit(actor, action, entity, detail = {}) {
    await this.run(
      "INSERT INTO audit_events(actor,action,entity,detail,at) VALUES(?,?,?,?,?)",
      actor,
      action,
      entity,
      JSON.stringify(detail),
      this.clock(),
    );
  }
  async setMode(cid, mode, actor, lock) {
    invariant(
      ["auto", "pending_human", "human"].includes(mode),
      "INVALID_INPUT",
    );
    await this.batch([
      this.lease(lock),
      this.q(
        "UPDATE conversations SET mode=?,mode_revision=mode_revision+1,actor=?,changed_at=? WHERE candidate_id=?",
        mode,
        actor,
        this.clock(),
        cid,
      ),
      this.q(
        "INSERT INTO audit_events(actor,action,entity,detail,at) VALUES(?,?,?,?,?)",
        actor,
        "conversation_mode",
        cid,
        JSON.stringify({ mode }),
        this.clock(),
      ),
    ]);
    return this.conversation(cid);
  }
  async active(cid) {
    return this.first(
      `SELECT b.*,s.starts_at,s.local_date,s.local_time,s.office_id,s.pool FROM bookings b JOIN sessions s ON s.id=b.session_id WHERE b.candidate_id=? AND b.status='confirmed' AND s.starts_at>? ORDER BY s.starts_at LIMIT 1`,
      cid,
      this.clock(),
    );
  }
  async booking(bid) {
    const row = await this.first(
      `SELECT b.*,s.starts_at,s.local_date,s.local_time,s.office_id,s.pool FROM bookings b JOIN sessions s ON s.id=b.session_id WHERE b.id=?`,
      bid,
    );
    invariant(row, "NOT_FOUND", 404);
    return { ...row, snapshot: JSON.parse(row.snapshot) };
  }
  async available(office, pool, exclude = null) {
    await this.ensureSessions();
    return this.all(
      `SELECT s.*, max(0,s.capacity-(SELECT count(*) FROM bookings b WHERE b.session_id=s.id AND b.status='confirmed' AND (? IS NULL OR b.id<>?))) AS remaining FROM sessions s WHERE s.office_id=? AND s.pool=? AND s.rule_active=1 AND s.manual_closed=0 AND s.starts_at>? AND s.local_date BETWEEN ? AND ? ORDER BY s.starts_at`,
      exclude,
      exclude,
      office,
      pool,
      this.clock() + 3600,
      localDate(this.clock()),
      localDate(this.clock() + 13 * 86400),
    );
  }
  async mutateBooking(
    {
      candidateId,
      sessionId,
      profile,
      bookingId = null,
      revision = null,
      cancel = false,
      key,
      actor,
      actorKind,
    },
    lock,
  ) {
    invariant(
      typeof key === "string" && key.length >= 8 && key.length <= 180,
      "INVALID_INPUT",
    );
    const hash = await sha(
      canonical({
        candidateId,
        sessionId: sessionId || null,
        profile: profile || null,
        bookingId,
        revision,
        cancel,
        actor,
        actorKind,
      }),
    );
    const opKey = actor + ":" + key,
      previous = await this.first(
        "SELECT * FROM operations WHERE key=?",
        opKey,
      );
    if (previous) {
      invariant(previous.payload_hash === hash, "IDEMPOTENCY_CONFLICT", 409);
      return this.booking(previous.booking_id);
    }
    const old = bookingId ? await this.booking(bookingId) : null;
    invariant(!old || old.candidate_id === candidateId, "FORBIDDEN", 403);
    const now = this.clock(),
      sid = cancel ? old?.session_id : sessionId;
    const session = await this.first("SELECT * FROM sessions WHERE id=?", sid);
    invariant(session, "INVALID_ACTION");
    const p = cancel
      ? {
          name: old.name,
          phone: old.phone,
          jobId: old.job_id,
          applyCity: old.apply_city,
          source: old.source,
        }
      : validateProfile(profile);
    if (!cancel) validateDestination(p, session.office_id);
    invariant(!bookingId || Number.isInteger(revision), "INVALID_INPUT");
    const bid = old?.id || id(),
      snapshot = cancel
        ? old.snapshot
        : {
            ...p,
            bookingId: bid,
            officeId: session.office_id,
            date: session.local_date,
            time: session.local_time,
            address: session.address,
            arrival: session.arrival,
            interviewer: session.interviewer,
          };
    const statements = [
      this.lease(lock),
      this.q(
        "INSERT INTO operations(key,actor,payload_hash,created_at) VALUES(?,?,?,?)",
        opKey,
        actor,
        hash,
        now,
      ),
    ];
    if (old) {
      statements.push(
        this.guard(
          "EXISTS(SELECT 1 FROM bookings WHERE id=? AND candidate_id=? AND revision=?)",
          bid,
          candidateId,
          revision,
        ),
        this.q(
          `UPDATE bookings SET session_id=?,job_id=?,apply_city=?,name=?,phone=?,source=?,status=?,snapshot=?,revision=revision+1,checked_at=?,retention_due=?,actor_kind=?,actor=? WHERE id=? AND revision=?`,
          sid,
          p.jobId,
          p.applyCity,
          p.name,
          p.phone,
          p.source,
          cancel ? "cancelled" : "confirmed",
          JSON.stringify(snapshot),
          now,
          cancel ? old.retention_due : retentionDate(session.local_date),
          actorKind,
          actor,
          bid,
          revision,
        ),
      );
    } else
      statements.push(
        this.q(
          `INSERT INTO bookings(id,candidate_id,session_id,job_id,apply_city,name,phone,source,snapshot,created_at,checked_at,retention_due,actor_kind,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          bid,
          candidateId,
          sid,
          p.jobId,
          p.applyCity,
          p.name,
          p.phone,
          p.source,
          JSON.stringify(snapshot),
          now,
          now,
          retentionDate(session.local_date),
          actorKind,
          actor,
        ),
      );
    statements.push(
      this.q("UPDATE operations SET booking_id=? WHERE key=?", bid, opKey),
    );
    await this.batch(statements);
    return this.booking(bid);
  }
  async saveConversation(
    cid,
    current,
    next,
    buttons,
    eventId,
    messages,
    ackHuman,
    lock,
  ) {
    const now = this.clock();
    await this.batch([
      this.lease(lock),
      this.guard(
        "EXISTS(SELECT 1 FROM conversations WHERE candidate_id=? AND revision=?)",
        cid,
        current.revision,
      ),
      this.q(
        "UPDATE conversations SET step=?,data=?,revision=revision+1,expires_at=?,last_event_timestamp=max(last_event_timestamp,?) WHERE candidate_id=?",
        next.step,
        JSON.stringify(next.data),
        now + 86400,
        next.eventTimestamp || 0,
        cid,
      ),
      ...buttons.map((b) =>
        this.q(
          "INSERT INTO action_tokens(token,candidate_id,kind,payload,revision,expires_at) VALUES(?,?,?,?,?,?)",
          b.token,
          cid,
          b.kind,
          JSON.stringify(b.payload || {}),
          current.revision + 1,
          now + 1800,
        ),
      ),
      this.q(
        `UPDATE webhook_events SET status='ready',response=?,response_mode_revision=(SELECT mode_revision FROM conversations WHERE candidate_id=?),ack_human=?,updated_at=? WHERE id=?`,
        JSON.stringify(messages),
        cid,
        ackHuman ? 1 : 0,
        now,
        eventId,
      ),
    ]);
  }
  async resolveAction(token, cid, revision) {
    invariant(
      typeof token === "string" && /^[a-f0-9-]{36}$/.test(token),
      "INVALID_ACTION",
    );
    const a = await this.first(
      "SELECT * FROM action_tokens WHERE token=? AND candidate_id=? AND revision=? AND expires_at>?",
      token,
      cid,
      revision,
      this.clock(),
    );
    invariant(a, "INVALID_ACTION");
    return { ...a, payload: JSON.parse(a.payload) };
  }
  async listBookings(filter) {
    const { where, params } = this.filter(filter);
    const rows = await this.all(
      `SELECT b.*,s.local_date,s.local_time,s.office_id,s.pool,s.starts_at FROM bookings b JOIN sessions s ON s.id=b.session_id ${where} ORDER BY s.starts_at,b.created_at LIMIT 1001`,
      ...params,
    );
    return rows.map((b) => ({ ...b, snapshot: JSON.parse(b.snapshot) }));
  }
  filter(f = {}) {
    const from = f.from || localDate(this.clock()),
      to = f.to || localDate(this.clock() + 13 * 86400);
    invariant(safeRange(from, to), "INVALID_DATE_RANGE");
    let sql = "WHERE s.local_date BETWEEN ? AND ?",
      params = [from, to];
    for (const [key, column, allowed] of [
      ["office", "s.office_id", seed.offices.map((o) => o.id)],
      ["pool", "s.pool", ["general", "admin"]],
      ["job", "b.job_id", seed.jobs.map((j) => j.id)],
      ["status", "b.status", ["confirmed", "cancelled"]],
      ["applyCity", "b.apply_city", seed.applicationCities],
    ]) {
      if (f[key]) {
        invariant(allowed.includes(f[key]), "INVALID_INPUT");
        sql += " AND " + column + "=?";
        params.push(f[key]);
      }
    }
    if (f.sessionId) {
      sql += " AND s.id=?";
      params.push(f.sessionId);
    }
    if (f.search) {
      invariant(f.search.length <= 80, "INVALID_INPUT");
      sql +=
        " AND (instr(b.name,?)>0 OR instr(b.phone,?)>0 OR instr(b.id,?)>0)";
      params.push(f.search, f.search, f.search);
    }
    return { where: sql, params };
  }
  async listSessions(
    from = localDate(this.clock()),
    to = localDate(this.clock() + 13 * 86400),
  ) {
    invariant(safeRange(from, to), "INVALID_DATE_RANGE");
    await this.ensureSessions();
    return this.all(
      `SELECT s.*, (SELECT count(*) FROM bookings b WHERE b.session_id=s.id AND b.status='confirmed') AS booked FROM sessions s WHERE s.local_date BETWEEN ? AND ? ORDER BY starts_at,office_id,pool`,
      from,
      to,
    );
  }
  async modeList(offset = 0) {
    invariant(
      Number.isInteger(offset) && offset >= 0 && offset <= 100000,
      "INVALID_INPUT",
    );
    return this.all(
      `SELECT c.id,v.mode,v.step,v.actor,v.changed_at,v.revision,COALESCE((SELECT name FROM bookings b WHERE b.candidate_id=c.id ORDER BY b.created_at DESC LIMIT 1),CASE WHEN v.expires_at>? THEN json_extract(v.data,'$.name') END) AS name FROM candidates c JOIN conversations v ON v.candidate_id=c.id ORDER BY CASE WHEN v.mode='pending_human' THEN 0 WHEN v.mode='human' THEN 1 ELSE 2 END,v.changed_at DESC,c.id LIMIT 201 OFFSET ?`,
      this.clock(),
      offset,
    );
  }
  async sessionChange(sid, revision, change, actor) {
    invariant(
      change.closed === undefined || typeof change.closed === "boolean",
      "INVALID_INPUT",
    );
    const s = await this.first("SELECT * FROM sessions WHERE id=?", sid);
    invariant(s, "NOT_FOUND", 404);
    invariant(Number.isInteger(revision), "INVALID_INPUT");
    const closed =
      change.closed === undefined
        ? s.manual_closed
        : change.closed === true
          ? 1
          : 0;
    const cap = change.capacity === undefined ? s.capacity : change.capacity;
    invariant(
      Number.isInteger(cap) && cap >= 1 && cap <= 99,
      "INVALID_CAPACITY",
    );
    const reason = String(change.reason || "").trim();
    invariant(reason.length >= 1 && reason.length <= 300, "REASON_REQUIRED");
    await this.batch([
      this.guard(
        "EXISTS(SELECT 1 FROM sessions WHERE id=? AND revision=?)",
        sid,
        revision,
      ),
      this.q(
        "UPDATE sessions SET manual_closed=?,capacity=?,reason=?,revision=revision+1 WHERE id=?",
        closed,
        cap,
        reason,
        sid,
      ),
      this.q(
        "INSERT INTO audit_events(actor,action,entity,detail,at) VALUES(?,?,?,?,?)",
        actor,
        "session_change",
        sid,
        JSON.stringify({ closed, capacity: cap, reason }),
        this.clock(),
      ),
    ]);
    return this.all(
      `SELECT id,name,phone,job_id FROM bookings WHERE session_id=? AND status='confirmed'`,
      sid,
    );
  }
  async addSession(input, actor) {
    const r = seed.weeklySchedules.find(
      (r) => r.officeId === input.officeId && r.pool === input.pool,
    );
    invariant(
      r &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time || "") &&
        safeRange(input.date, input.date),
      "INVALID_INPUT",
    );
    invariant(
      input.pool !== "admin" ||
        (input.officeId === "taichung" &&
          weekday(input.date) === 3 &&
          input.time === "14:00"),
      "INVALID_ADMIN_TIME",
    );
    invariant(
      input.date >= localDate(this.clock()) &&
        input.date <= localDate(this.clock() + 13 * 86400),
      "OUTSIDE_WINDOW",
    );
    const cap = input.capacity ?? 5;
    invariant(
      Number.isInteger(cap) && cap >= 1 && cap <= 99,
      "INVALID_CAPACITY",
    );
    const o = seed.offices.find((o) => o.id === input.officeId),
      sid = id(),
      reason = String(input.reason || "").trim(),
      staff = (await this.setting("staff")).value;
    invariant(reason.length > 0 && reason.length <= 300, "REASON_REQUIRED");
    await this.batch([
      this.q(
        `INSERT INTO sessions(id,office_id,pool,starts_at,local_date,local_time,capacity,address,arrival,interviewer,config_revision,source,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sid,
        o.id,
        r.pool,
        startsAt(input.date, input.time),
        input.date,
        input.time,
        cap,
        o.address + (o.landmark ? " (" + o.landmark + ")" : ""),
        o.arrival,
        interviewerFor(
          staff.directors,
          staff.assignments,
          o.id,
          r.pool,
          input.date,
          input.time,
        ),
        0,
        "extra",
        reason,
      ),
      this.q(
        "INSERT INTO audit_events(actor,action,entity,detail,at) VALUES(?,?,?,?,?)",
        actor,
        "session_added",
        sid,
        JSON.stringify({
          date: input.date,
          time: input.time,
          pool: r.pool,
          reason,
        }),
        this.clock(),
      ),
    ]);
    return { id: sid };
  }
  async schedulePreview(input) {
    const rules = validateSchedules(input.rules);
    invariant(
      safeRange(input.effectiveDate, input.effectiveDate) &&
        input.effectiveDate >= localDate(this.clock()),
      "INVALID_EFFECTIVE_DATE",
    );
    const c = await this.setting("schedules");
    invariant(input.revision === c.revision, "STALE_REVISION", 409);
    invariant(
      !c.value.pending ||
        c.value.pending.effectiveDate <= localDate(this.clock()) ||
        c.value.pending.effectiveDate === input.effectiveDate,
      "PENDING_SCHEDULE_EXISTS",
      409,
    );
    const sessions = await this.all(
      `SELECT s.*,(SELECT count(*) FROM bookings b WHERE b.session_id=s.id AND b.status='confirmed') AS booked FROM sessions s WHERE s.source='weekly' AND s.local_date>=?`,
      input.effectiveDate,
    );
    const affected = sessions
      .map((s) => {
        const r = rules.find(
          (r) => r.officeId === s.office_id && r.pool === s.pool,
        );
        return {
          ...s,
          newCapacity: r.capacity,
          removed: !(r.isoWeekdays[weekday(s.local_date)] || []).includes(
            s.local_time,
          ),
        };
      })
      .filter(
        (s) =>
          s.rule_active !== (s.removed ? 0 : 1) || s.capacity !== s.newCapacity,
      );
    return { rules, affected };
  }
  async saveScheduleDraft(input, actor) {
    await this.schedulePreview(input);
    await this.batch([
      this.guard(
        "(SELECT revision FROM settings WHERE key=?)=?",
        "schedules",
        input.revision,
      ),
      this.q(
        "UPDATE settings SET draft=?,revision=revision+1,updated_at=?,actor=? WHERE key=?",
        JSON.stringify(input),
        this.clock(),
        actor,
        "schedules",
      ),
    ]);
  }
  async publishSchedule(input, actor) {
    const { rules, affected } = await this.schedulePreview(input),
      config = await this.setting("schedules");
    const current = this.scheduleFor(config.value, localDate(this.clock()));
    const next = {
      current,
      pending: { effectiveDate: input.effectiveDate, rules },
    };
    await this.batch([
      this.guard(
        "(SELECT revision FROM settings WHERE key=?)=?",
        "schedules",
        input.revision,
      ),
      this.q(
        "UPDATE settings SET value=?,draft=NULL,revision=revision+1,updated_at=?,actor=? WHERE key=?",
        JSON.stringify(next),
        this.clock(),
        actor,
        "schedules",
      ),
      this.q(
        "UPDATE sessions SET rule_active=json_extract(j.value,'$.active'),capacity=json_extract(j.value,'$.capacity'),config_revision=?,revision=revision+1 FROM json_each(?) j WHERE sessions.id=json_extract(j.value,'$.id')",
        input.revision + 1,
        JSON.stringify(
          affected.map((s) => ({
            id: s.id,
            active: s.removed ? 0 : 1,
            capacity: s.newCapacity,
          })),
        ),
      ),
      this.q(
        "INSERT INTO audit_events(actor,action,entity,detail,at) VALUES(?,?,?,?,?)",
        actor,
        "schedule_published",
        "schedules",
        JSON.stringify({
          effectiveDate: input.effectiveDate,
          affected: affected.map((s) => s.id),
        }),
        this.clock(),
      ),
    ]);
    await this.ensureSessions();
    return { affected };
  }
  async saveStaff(input, actor) {
    const directors = validateDirectors(input.directors);
    const config = await this.setting("schedules");
    const rules = validateSchedules(
      input.rules ||
        config.draft?.rules ||
        config.value.pending?.rules ||
        config.value.current,
    );
    const assignments = validateAssignments(
      input.assignments || {},
      directors,
      rules,
    );
    const staff = await this.setting("staff");
    invariant(
      input.revision === undefined || input.revision === staff.revision,
      "STALE_REVISION",
      409,
    );
    await this.batch([
      this.guard(
        "(SELECT revision FROM settings WHERE key=?)=?",
        "staff",
        staff.revision,
      ),
      this.q(
        "UPDATE settings SET value=?,draft=NULL,revision=revision+1,updated_at=?,actor=? WHERE key=?",
        JSON.stringify({ directors, assignments }),
        this.clock(),
        actor,
        "staff",
      ),
      this.q(
        "INSERT INTO audit_events(actor,action,entity,detail,at) VALUES(?,?,?,?,?)",
        actor,
        "staff_saved",
        "staff",
        JSON.stringify({ count: directors.length }),
        this.clock(),
      ),
    ]);
    await this.ensureSessions();
    return this.setting("staff");
  }
  async templateDraft(key, text, actor, revision) {
    validateTemplate(key, text);
    const c = await this.setting("templates");
    invariant(c.revision === revision, "STALE_REVISION", 409);
    await this.batch([
      this.guard(
        "(SELECT revision FROM settings WHERE key=?)=?",
        "templates",
        revision,
      ),
      this.q(
        "UPDATE settings SET draft=?,revision=revision+1,updated_at=?,actor=? WHERE key=?",
        JSON.stringify({ ...c.draft, [key]: text }),
        this.clock(),
        actor,
        "templates",
      ),
    ]);
  }
  async publishTemplate(key, text, actor, revision) {
    validateTemplate(key, text);
    const c = await this.setting("templates"),
      value = {
        ...c.value,
        [key]: { text, version: c.value[key].version + 1 },
      },
      draft = { ...c.draft };
    delete draft[key];
    await this.batch([
      this.guard(
        "(SELECT revision FROM settings WHERE key=?)=?",
        "templates",
        revision,
      ),
      this.q(
        "UPDATE settings SET value=?,draft=?,revision=revision+1,updated_at=?,actor=? WHERE key=?",
        JSON.stringify(value),
        JSON.stringify(draft),
        this.clock(),
        actor,
        "templates",
      ),
      this.q(
        "INSERT INTO audit_events(actor,action,entity,detail,at) VALUES(?,?,?,?,?)",
        actor,
        "template_published",
        key,
        JSON.stringify({ version: value[key].version }),
        this.clock(),
      ),
    ]);
    return this.setting("templates");
  }
  async retention(dryRun = true, actor = "maintenance") {
    const today = localDate(this.clock()),
      rows = await this.all(
        "SELECT id,retention_due FROM bookings WHERE retention_due<=? ORDER BY retention_due LIMIT 31",
        today,
      );
    const hasMore = rows.length > 30;
    rows.splice(30);
    if (!dryRun) {
      await this.batch([
        ...rows.map((b) =>
          this.q(
            "DELETE FROM bookings WHERE id=? AND retention_due<=?",
            b.id,
            today,
          ),
        ),
        this.q("DELETE FROM action_tokens WHERE expires_at<=?", this.clock()),
        this.q("DELETE FROM webhook_events WHERE expires_at<=?", this.clock()),
        this.q(
          "UPDATE webhook_events SET response=NULL,delivery_status=CASE WHEN status='done' THEN delivery_status ELSE 'expired' END,status='done' WHERE updated_at<=?",
          this.clock() - 86400,
        ),
        this.q(
          "DELETE FROM audit_events WHERE at<?",
          this.clock() - 366 * 86400,
        ),
        this.q("DELETE FROM locks WHERE expires_at<=?", this.clock()),
        this.q(
          "UPDATE conversations SET data='{}',step='home' WHERE expires_at<=?",
          this.clock(),
        ),
        this.q("DELETE FROM rate_limits WHERE expires_at<=?", this.clock()),
        this.q(
          "DELETE FROM candidates WHERE last_seen<? AND NOT EXISTS(SELECT 1 FROM bookings WHERE candidate_id=candidates.id) AND EXISTS(SELECT 1 FROM conversations WHERE candidate_id=candidates.id AND mode='auto')",
          this.clock() - 366 * 86400,
        ),
        this.q(
          "INSERT INTO audit_events(actor,action,entity,detail,at) VALUES(?,?,?,?,?)",
          actor,
          "retention_purge",
          "bookings",
          JSON.stringify({ count: rows.length, date: today }),
          this.clock(),
        ),
      ]);
    }
    return { dryRun, date: today, count: rows.length, bookings: rows, hasMore };
  }
}
function safeRange(from, to) {
  return (
    safeDate(from) &&
    safeDate(to) &&
    to >= from &&
    startsAt(to, "00:00") - startsAt(from, "00:00") <= 366 * 86400
  );
}
