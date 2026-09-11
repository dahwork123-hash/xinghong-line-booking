import test from "node:test";
import assert from "node:assert/strict";
import { fixture, book, profile, NOW } from "./helpers.mjs";
import { startsAt, seed } from "../src/domain.mjs";

test("current Taichung schedule and administrative TOBY pool", async (t) => {
  const f = await fixture(t),
    rows = await f.store.listSessions();
  assert.deepEqual(
    rows
      .filter(
        (s) =>
          s.office_id === "taichung" &&
          s.local_date === "2026-09-09" &&
          s.pool === "general",
      )
      .map((s) => s.local_time),
    ["10:00", "14:00", "16:00"],
  );
  assert.equal(
    rows.find((s) => s.id === "taichung_2026-09-09_1400_admin").interviewer,
    "TOBY",
  );
  assert.equal(
    rows.find((s) => s.id === "taichung_2026-09-08_1400_general").interviewer,
    "台中處長",
  );
  assert.ok(
    rows.every(
      (s) => s.local_date >= "2026-09-08" && s.local_date <= "2026-09-21",
    ),
  );
});
test("renaming a director updates interviewer on weekly sessions", async (t) => {
  const f = await fixture(t),
    staff = await f.store.setting("staff");
  await f.store.saveStaff(
    {
      directors: staff.value.directors.map((d) =>
        d.id === "taichung-general" ? { ...d, name: "王處長" } : d,
      ),
      assignments: staff.value.assignments,
      revision: staff.revision,
    },
    "test@example.invalid",
  );
  const rows = await f.store.listSessions();
  assert.equal(
    rows.find((s) => s.id === "taichung_2026-09-08_1400_general").interviewer,
    "王處長",
  );
});
test("five shared general seats and five separate administrative seats", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++)
    await book(f, await f.candidate(), undefined, {
      profile: {
        ...profile,
        jobId: i % 2 ? "management_trainee" : "housing_advisor",
      },
    });
  await assert.rejects(book(f, await f.candidate()), { code: "SLOT_FULL" });
  for (let i = 0; i < 5; i++)
    await book(f, await f.candidate(), "taichung_2026-09-09_1400_admin", {
      profile: { ...profile, jobId: "admin" },
    });
  await assert.rejects(
    book(f, await f.candidate(), "taichung_2026-09-09_1400_admin", {
      profile: { ...profile, jobId: "admin" },
    }),
    { code: "SLOT_FULL" },
  );
  assert.equal((await f.store.listBookings({})).length, 10);
});
test("one future booking, idempotent retry, mismatch conflict", async (t) => {
  const f = await fixture(t),
    c = await f.candidate(),
    extra = { key: "stable-key-123" };
  const b = await book(f, c, undefined, extra),
    same = await book(f, c, undefined, extra);
  assert.equal(b.id, same.id);
  await assert.rejects(book(f, c, "taichung_2026-09-10_1400_general", extra), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  await assert.rejects(book(f, c, "taichung_2026-09-10_1400_general"), {
    code: "ACTIVE_BOOKING_EXISTS",
  });
  assert.equal((await f.store.all("SELECT * FROM booking_events")).length, 1);
});
test("cutoff closes exactly one hour before, same-day earlier works", async (t) => {
  const f = await fixture(t);
  f.setTime(startsAt("2026-09-08", "09:59") + 59);
  await book(f, await f.candidate(), "taichung_2026-09-08_1100_general");
  f.setTime(startsAt("2026-09-08", "10:00"));
  await assert.rejects(
    book(f, await f.candidate(), "taichung_2026-09-08_1100_general"),
    { code: "CUTOFF_PASSED" },
  );
});
test("failed reschedule preserves old booking and history; cancel frees seat", async (t) => {
  const f = await fixture(t),
    cid = await f.candidate(),
    old = await book(f, cid, "taichung_2026-09-10_1100_general");
  for (let i = 0; i < 5; i++) await book(f, await f.candidate());
  await assert.rejects(
    book(f, cid, undefined, { bookingId: old.id, revision: 1 }),
    { code: "SLOT_FULL" },
  );
  assert.equal((await f.store.booking(old.id)).session_id, old.session_id);
  assert.equal(
    (
      await f.store.all(
        "SELECT * FROM booking_events WHERE booking_id=?",
        old.id,
      )
    ).length,
    1,
  );
  const target = (await f.store.listBookings({})).find((b) => b.id !== old.id);
  await book(f, target.candidate_id, null, {
    bookingId: target.id,
    revision: 1,
    cancel: true,
  });
  const changed = await book(f, cid, undefined, {
    bookingId: old.id,
    revision: 1,
  });
  assert.equal(changed.revision, 2);
  await assert.rejects(
    book(f, cid, "taichung_2026-09-10_1400_general", {
      bookingId: old.id,
      revision: 1,
    }),
    { code: "STALE_REVISION" },
  );
});
test("cancel before start allowed even after booking cutoff, start disallows", async (t) => {
  const f = await fixture(t),
    cid = await f.candidate(),
    b = await book(f, cid);
  f.setTime(startsAt("2026-09-09", "13:59"));
  await book(f, cid, null, { bookingId: b.id, revision: 1, cancel: true });
  const c2 = await f.candidate(),
    b2 = await book(f, c2, "taichung_2026-09-10_1100_general");
  f.setTime(startsAt("2026-09-10", "11:00"));
  await assert.rejects(
    book(f, c2, null, { bookingId: b2.id, revision: 1, cancel: true }),
    { code: "INTERVIEW_STARTED" },
  );
});
test("manual mode survives draft expiry; self-service blocked but staff can book", async (t) => {
  const f = await fixture(t),
    cid = await f.candidate();
  await f.store.withLock("candidate:" + cid, (l) =>
    f.store.setMode(cid, "human", "staff", l),
  );
  f.setTime(NOW + 86401);
  assert.equal((await f.store.conversation(cid)).mode, "human");
  await assert.rejects(
    book(f, cid, "taichung_2026-09-10_1100_general", { actorKind: "line" }),
    { code: "HUMAN_HANDOFF" },
  );
  await book(f, cid, "taichung_2026-09-10_1100_general");
});
test("closed session and wrong destination blocked; lowering capacity never deletes", async (t) => {
  const f = await fixture(t),
    b = await book(f, await f.candidate()),
    s = await f.store.first("SELECT * FROM sessions WHERE id=?", b.session_id);
  await f.store.sessionChange(
    s.id,
    s.revision,
    { closed: true, capacity: 1, reason: "test" },
    "staff",
  );
  await assert.rejects(book(f, await f.candidate()), {
    code: "SESSION_CLOSED",
  });
  assert.equal((await f.store.booking(b.id)).status, "confirmed");
  await assert.rejects(
    book(f, await f.candidate(), "changhua_2026-09-10_1400_general"),
    { code: "INVALID_DESTINATION" },
  );
});
test("new schedule publication can re-enable removed session without losing manual closure", async (t) => {
  const f = await fixture(t),
    rules = structuredClone(seed.weeklySchedules);
  rules.find(
    (r) => r.officeId === "taichung" && r.pool === "general",
  ).isoWeekdays[3] = ["10:00"];
  await f.store.publishSchedule(
    { revision: 1, effectiveDate: "2026-09-08", rules },
    "staff",
  );
  const sid = "taichung_2026-09-09_1400_general";
  assert.equal(
    (await f.store.first("SELECT * FROM sessions WHERE id=?", sid)).rule_active,
    0,
  );
  await f.store.publishSchedule(
    { revision: 2, effectiveDate: "2026-09-08", rules: seed.weeklySchedules },
    "staff",
  );
  assert.equal(
    (await f.store.first("SELECT * FROM sessions WHERE id=?", sid)).rule_active,
    1,
  );
});
test("draft writes reject stale concurrent edits for schedules and canned messages", async (t) => {
  const f = await fixture(t),
    input = {
      revision: 1,
      effectiveDate: "2026-09-08",
      rules: seed.weeklySchedules,
    };
  await f.store.saveScheduleDraft(input, "a");
  await assert.rejects(f.store.saveScheduleDraft(input, "b"), {
    code: "STALE_REVISION",
  });
  await f.store.templateDraft("salary_general", "核定測試內容", "a", 1);
  await assert.rejects(
    f.store.templateDraft("salary_general", "另一位", "b", 1),
    { code: "STALE_REVISION" },
  );
  assert.notEqual(
    (await f.store.setting("templates")).value.salary_general.text,
    "核定測試內容",
  );
});
test("filter parameters resist SQL injection and invalid date gives known validation error", async (t) => {
  const f = await fixture(t);
  await book(f, await f.candidate());
  assert.equal(
    (await f.store.listBookings({ search: "' OR 1=1 --" })).length,
    0,
  );
  await assert.rejects(f.store.listBookings({ from: "2026-13-01" }), {
    code: "INVALID_DATE_RANGE",
  });
});
test("retention cascades expired booking data but preserves newer booking for same identity", async (t) => {
  const f = await fixture(t),
    cid = await f.candidate(),
    old = await book(f, cid);
  f.setTime(startsAt("2027-09-09", "08:00"));
  await f.store.ensureSessions();
  const future = (await f.store.available("taichung", "general")).find(
    (s) => s.remaining > 0,
  );
  const newer = await book(f, cid, future.id);
  const preview = await f.store.retention();
  assert.equal(preview.count, 1);
  await f.store.retention(false, "staff");
  await assert.rejects(f.store.booking(old.id), { code: "NOT_FOUND" });
  assert.equal((await f.store.booking(newer.id)).id, newer.id);
  assert.equal(
    (
      await f.store.all(
        "SELECT * FROM booking_events WHERE booking_id=?",
        old.id,
      )
    ).length,
    0,
  );
  assert.equal(
    (await f.store.all("SELECT * FROM operations WHERE booking_id=?", old.id))
      .length,
    0,
  );
});
