import test from "node:test";
import assert from "node:assert/strict";
import {
  safeDate,
  startsAt,
  localDate,
  retentionDate,
  validateProfile,
  validateDestination,
  validateSchedules,
  validateTemplate,
  parseLegacy,
  seed,
  validateDirectors,
  defaultAssignments,
  interviewerFor,
} from "../src/domain.mjs";
import { profile } from "./helpers.mjs";

test("Taiwan calendar boundary and leap year retention", () => {
  assert.equal(localDate(startsAt("2026-09-08", "00:00") - 1), "2026-09-07");
  assert.equal(retentionDate("2028-02-29"), "2029-02-28");
  for (const d of ["2026-02-29", "2026-13-01", "bad", "2026-09-32", null])
    assert.equal(safeDate(d), false);
});
test("minimum fields, leading zero phone, optional source and example rejection", () => {
  assert.equal(
    validateProfile({ ...profile, phone: "0900-000-001" }).phone,
    "0900000001",
  );
  assert.equal(
    validateProfile({ ...profile, source: undefined }).source,
    "未知",
  );
  for (const p of [
    { name: "星小鴻" },
    { phone: "0912345678" },
    { name: "a\n" },
    { phone: "test" },
    { jobId: "insurance" },
    { applyCity: "台北" },
    { source: "<script>" },
  ]) {
    const data = { ...profile, ...p };
    if (p.name === "a\n") data.name = "a\nb";
    assert.throws(() => validateProfile(data));
  }
});
test("destination rules preserve Nantou and administrative office", () => {
  validateDestination({ ...profile, applyCity: "南投" }, "changhua");
  validateDestination(
    { ...profile, jobId: "admin", applyCity: "新竹" },
    "taichung",
  );
  assert.throws(() =>
    validateDestination({ ...profile, applyCity: "南投" }, "chiayi"),
  );
  assert.throws(() => validateDestination(profile, "changhua"));
});
test("published templates require all variables and reject unknown ones", () => {
  for (const t of seed.templates) validateTemplate(t.key, t.text);
  assert.throws(() => validateTemplate("booking_success", "已預約"));
  assert.throws(() => validateTemplate("salary_general", "{{secret}}"));
});
test("weekly schedule cannot mix or duplicate capacity pools", () => {
  validateSchedules(seed.weeklySchedules);
  const duplicate = structuredClone(seed.weeklySchedules);
  duplicate[1] = duplicate[0];
  assert.throws(() => validateSchedules(duplicate));
  const bad = structuredClone(seed.weeklySchedules);
  bad[0].isoWeekdays[1] = ["11:00", "11:00"];
  assert.throws(() => validateSchedules(bad));
});
test("legacy form uses application city, never home city", () => {
  const p = parseLegacy(
    "【姓名】；測試者\n【居住縣市/行政區】；新竹\n【應徵縣市】；南投\n【收到應徵職務名稱】；1.社宅顧問\n【連絡電話】；0900000001",
  );
  assert.equal(p.applyCity, "南投");
  assert.equal(p.jobId, "housing_advisor");
  assert.equal(parseLegacy("【收到應徵職務名稱】社宅顧問/儲備主管").jobId, "");
});
test("each weekly slot can resolve a director name", () => {
  const directors = validateDirectors(seed.directors);
  const assignments = defaultAssignments(directors);
  assert.equal(
    interviewerFor(
      directors,
      assignments,
      "taichung",
      "admin",
      "2026-09-09",
      "14:00",
    ),
    "TOBY",
  );
  assert.equal(
    interviewerFor(
      directors,
      assignments,
      "taichung",
      "general",
      "2026-09-08",
      "14:00",
    ),
    "中一處 黃岳澤",
  );
  assert.throws(() =>
    validateDirectors(
      directors.filter((d) => !(d.officeId === "taichung" && d.pool === "general")),
    ),
  );
});
