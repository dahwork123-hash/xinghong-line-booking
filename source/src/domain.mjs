import seed from "../seed.json" with { type: "json" };

export { seed };
export const epoch = () => Math.floor(Date.now() / 1000);
export const id = () => crypto.randomUUID();
export const localDate = (seconds) =>
  new Date((seconds + 28800) * 1000).toISOString().slice(0, 10);
export function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return (
    String(Math.floor(t / 60)).padStart(2, "0") +
    ":" +
    String(t % 60).padStart(2, "0")
  );
}
export function parseSlotTime(value) {
  const s = String(value || "").trim();
  const m = s.match(
    /^(([01]\d|2[0-3]):[0-5]\d)(?:\s*[-–~到至]\s*(([01]\d|2[0-3]):[0-5]\d))?$/,
  );
  if (!m) return null;
  return { start: m[1], end: m[3] || addMinutes(m[1], 120) };
}
export function slotToken(start, end) {
  const p = parseSlotTime(end ? start + "-" + end : start);
  return p ? p.start + "-" + p.end : "";
}
export function formatSlotRange(value) {
  const p = parseSlotTime(value);
  return p ? p.start + "–" + p.end : String(value || "");
}
export const startsAt = (date, time) => {
  const start = parseSlotTime(time)?.start || time;
  return Date.parse(`${date}T${start}:00+08:00`) / 1000;
};
export const weekday = (date) =>
  new Date(`${date}T12:00:00+08:00`).getUTCDay() || 7;
export const poolFor = (job) => (job === "admin" ? "admin" : "general");
export const jobLabel = (job) =>
  seed.jobs.find((j) => j.id === job)?.label || "";
export const officeLabel = (office) =>
  seed.offices.find((o) => o.id === office)?.city || "";
export const dateLabel = (date) =>
  `${date.replaceAll("-", "/")}（${["", "一", "二", "三", "四", "五", "六", "日"][weekday(date)]}）`;
export class AppError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function invariant(ok, code, status = 400) {
  if (!ok) throw new AppError(code, status);
}
export async function sha(value) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function safeDate(date) {
  return (
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(startsAt(date, "00:00")) &&
    localDate(startsAt(date, "00:00")) === date
  );
}
export function retentionDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
export function validateProfile(p) {
  invariant(p && typeof p === "object" && !Array.isArray(p), "INVALID_INPUT");
  const name = String(p.name || "").trim(),
    phone = String(p.phone || "").replace(/[\s()-]/g, "");
  invariant(
    name.length >= 1 &&
      name.length <= 80 &&
      !/[\u0000-\u001f\u007f]/.test(name),
    "INVALID_NAME",
  );
  invariant(
    !["姓名", "星小鴻", "範例姓名", "請填姓名"].includes(name),
    "EXAMPLE_DATA",
  );
  invariant(
    /^(?:0\d{8,10}|\+[1-9]\d{7,14})(?:x\d{1,6})?$/.test(phone),
    "INVALID_PHONE",
  );
  invariant(phone !== "0912345678", "EXAMPLE_DATA");
  invariant(
    seed.jobs.some((j) => j.id === p.jobId),
    "INVALID_JOB",
  );
  invariant(seed.applicationCities.includes(p.applyCity), "INVALID_CITY");
  const source = p.source || "未知";
  invariant(seed.sources.includes(source), "INVALID_SOURCE");
  return { name, phone, jobId: p.jobId, applyCity: p.applyCity, source };
}
export function validateDestination(profile, office) {
  if (profile.jobId === "admin")
    return invariant(office === "taichung", "INVALID_DESTINATION");
  if (profile.applyCity === "南投")
    return invariant(
      ["taichung", "changhua"].includes(office),
      "INVALID_DESTINATION",
    );
  invariant(officeLabel(office) === profile.applyCity, "INVALID_DESTINATION");
}
export function validateSchedules(input) {
  invariant(
    Array.isArray(input) && input.length === seed.weeklySchedules.length,
    "INVALID_SCHEDULE",
  );
  const expected = new Set(
      seed.weeklySchedules.map((r) => r.officeId + "|" + r.pool),
    ),
    seen = new Set();
  for (const r of input) {
    const key = r.officeId + "|" + r.pool;
    invariant(expected.has(key) && !seen.has(key), "INVALID_SCHEDULE");
    seen.add(key);
    invariant(
      Number.isInteger(r.capacity) && r.capacity >= 1 && r.capacity <= 99,
      "INVALID_CAPACITY",
    );
    invariant(
      r.isoWeekdays &&
        typeof r.isoWeekdays === "object" &&
        !Array.isArray(r.isoWeekdays),
      "INVALID_SCHEDULE",
    );
    for (const [d, times] of Object.entries(r.isoWeekdays)) {
      invariant(
        /^[1-7]$/.test(d) && Array.isArray(times) && times.length <= 8,
        "INVALID_SCHEDULE",
      );
      const parsed = times.map((t) =>
        typeof t === "string" ? parseSlotTime(t) : null,
      );
      invariant(
        parsed.every((p) => p && p.end > p.start) &&
          new Set(parsed.map((p) => p.start)).size === parsed.length,
        "INVALID_TIME",
      );
    }
  }
  invariant(
    input.reduce(
      (total, r) =>
        total + Object.values(r.isoWeekdays).reduce((n, t) => n + t.length, 0),
      0,
    ) <= 40,
    "SCHEDULE_LIMIT",
  );
  return input.map((r) => ({
    officeId: r.officeId,
    pool: r.pool,
    capacity: r.capacity,
    isoWeekdays: Object.fromEntries(
      Object.entries(r.isoWeekdays).map(([d, times]) => [
        d,
        times.map((t) => slotToken(t)),
      ]),
    ),
  }));
}
export function slotKey(officeId, pool, day, time) {
  return (
    officeId +
    "|" +
    pool +
    "|" +
    day +
    "|" +
    (parseSlotTime(time)?.start || time)
  );
}
export function defaultAssignments(directors = seed.directors) {
  const map = {};
  for (const r of seed.weeklySchedules) {
    const dir = directors.find(
      (d) => d.officeId === r.officeId && d.pool === r.pool,
    );
    for (const [day, times] of Object.entries(r.isoWeekdays))
      for (const time of times)
        if (dir) map[slotKey(r.officeId, r.pool, day, time)] = dir.id;
  }
  return map;
}
export function validateDirectors(list) {
  invariant(
    Array.isArray(list) && list.length >= 1 && list.length <= 40,
    "INVALID_DIRECTOR",
  );
  const ids = new Set();
  const rows = list.map((d) => {
    invariant(d && typeof d === "object" && !Array.isArray(d), "INVALID_DIRECTOR");
    const id = String(d.id || "").trim();
    invariant(/^[a-zA-Z0-9-]{2,64}$/.test(id) && !ids.has(id), "INVALID_DIRECTOR");
    ids.add(id);
    const name = String(d.name || "").trim();
    invariant(
      name.length >= 1 && name.length <= 40 && !/[\u0000-\u001f\u007f]/.test(name),
      "INVALID_DIRECTOR_NAME",
    );
    const title = String(d.title || "處長").trim();
    invariant(["處長", "主管", "面試官"].includes(title), "INVALID_DIRECTOR");
    invariant(
      seed.offices.some((o) => o.id === d.officeId),
      "INVALID_DIRECTOR",
    );
    invariant(d.pool === "general" || d.pool === "admin", "INVALID_DIRECTOR");
    invariant(d.pool !== "admin" || d.officeId === "taichung", "INVALID_DIRECTOR");
    const notifyEmail = String(d.notifyEmail || "").trim();
    invariant(
      !notifyEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail),
      "INVALID_DIRECTOR_EMAIL",
    );
    const notifyLine = String(d.notifyLine || "").trim();
    invariant(notifyLine.length <= 80, "INVALID_DIRECTOR");
    const unit = String(d.unit || "").trim();
    invariant(unit.length <= 20 && !/[\u0000-\u001f\u007f]/.test(unit), "INVALID_DIRECTOR");
    return {
      id,
      name,
      title,
      unit,
      officeId: d.officeId,
      pool: d.pool,
      notifyEmail,
      notifyLine,
    };
  });
  return rows;
}
export function validateAssignments(map, directors, rules) {
  invariant(map && typeof map === "object" && !Array.isArray(map), "INVALID_DIRECTOR");
  const ids = new Set(directors.map((d) => d.id));
  const out = {};
  for (const r of rules)
    for (const [day, times] of Object.entries(r.isoWeekdays || {}))
      for (const time of times) {
        const key = slotKey(r.officeId, r.pool, day, time);
        const fallback = directors.find(
          (d) => d.officeId === r.officeId && d.pool === r.pool,
        );
        const dirId = map[key] || fallback?.id;
        if (!dirId) continue;
        invariant(ids.has(dirId), "INVALID_DIRECTOR");
        const dir = directors.find((d) => d.id === dirId);
        invariant(
          dir.officeId === r.officeId && dir.pool === r.pool,
          "INVALID_DIRECTOR",
        );
        out[key] = dirId;
      }
  return out;
}
export function interviewerLabel(dir) {
  if (!dir) return "";
  return [dir.unit, dir.name].filter(Boolean).join(" ");
}
export function interviewerFor(directors, assignments, officeId, pool, date, time) {
  const key = slotKey(officeId, pool, String(weekday(date)), time);
  const dir =
    directors.find((d) => d.id === assignments[key]) ||
    directors.find((d) => d.officeId === officeId && d.pool === pool);
  return interviewerLabel(dir);
}
export function validateTemplate(key, text) {
  const t = seed.templates.find((t) => t.key === key);
  invariant(t, "INVALID_TEMPLATE");
  invariant(
    typeof text === "string" && text.trim().length > 0 && text.length <= 2000,
    "INVALID_TEMPLATE",
  );
  const required = t.requiredVariables || [],
    allowed = new Set([
      ...required,
      ...(key === "missing_field" ? ["field"] : []),
    ]);
  const vars = [...text.matchAll(/{{([^}]+)}}/g)].map((m) => m[1]);
  invariant(
    vars.every((v) => allowed.has(v)) &&
      required.every((v) => vars.includes(v)),
    "INVALID_TEMPLATE_VARIABLES",
  );
  invariant(
    !text.replace(/{{[^}]+}}/g, "").includes("{{") &&
      !text.replace(/{{[^}]+}}/g, "").includes("}}"),
    "INVALID_TEMPLATE_VARIABLES",
  );
  return text;
}
export function parseLegacy(text) {
  const fields = {};
  for (const m of text.matchAll(/【([^】]+)】\s*[:：;；]?\s*([^【\r\n]*)/g))
    fields[m[1].trim()] = m[2].trim();
  const rawJob = fields["應徵職務"] || fields["收到應徵職務名稱"] || "";
  const matches = seed.jobs.filter(
    (j) => rawJob.replace(/^\d+[.、．]\s*/, "") === j.label,
  );
  return {
    name: fields["姓名"] || "",
    phone: fields["連絡電話"] || fields["聯絡電話"] || "",
    jobId: matches.length === 1 ? matches[0].id : "",
    applyCity: seed.applicationCities.includes(fields["應徵縣市"])
      ? fields["應徵縣市"]
      : "",
    source: seed.sources.includes(fields["加入來源"])
      ? fields["加入來源"]
      : "未知",
  };
}
export const messages = {
  INVALID_INPUT: "資料格式不正確，請重新確認。",
  INVALID_NAME: "請提供您的姓名。",
  INVALID_PHONE: "電話格式需要再確認，請重新輸入。",
  EXAMPLE_DATA: "這看起來是格式範例，請改填您本人的資料。",
  SLOT_FULL: "這個時段的線上預約名額已滿，請選其他方便的時段。",
  CUTOFF_PASSED: "這個時段已截止預約，請重新選擇日期時間。",
  OUTSIDE_WINDOW: "這個日期尚未開放，請重新選擇。",
  SESSION_CLOSED: "這個場次目前不開放預約，請選其他場次。",
  ACTIVE_BOOKING_EXISTS:
    "您已有一筆尚未開始的面試預約，請使用「我的預約」修改。",
  STALE_REVISION: "畫面或資料已更新，請重新查詢後再操作。",
  HUMAN_HANDOFF: "目前由招募同仁協助，請稍候。",
  INTERVIEW_STARTED: "面試已開始，無法自行異動，請聯絡招募同仁。",
  INVALID_JOB: "請重新選擇應徵職務。",
  INVALID_CITY: "請重新選擇應徵縣市。",
  INVALID_DESTINATION: "應徵地與面試地需要再確認。",
  INVALID_SOURCE: "請重新選擇來源，或略過。",
  UNAUTHORIZED: "請登入授權帳號。",
  FORBIDDEN: "此操作未獲授權。",
  BUSY: "資料正在處理中，請稍後重試。",
  SERVICE_NOT_READY: "服務尚未開放，請由招募同仁協助。",
  PERSISTENCE_FAILED: "暫時無法完成，請查詢原預約或聯絡同仁。",
  INVALID_ACTION: "按鈕已失效，請從預約選單重新開始。",
  ALREADY_CANCELLED: "這筆預約已取消。",
  EXPORT_TOO_LARGE: "資料超過匯出上限，請縮小面試日期範圍。",
  INVALID_DIRECTOR: "處長資料需要再確認。",
  INVALID_DIRECTOR_NAME: "請填寫處長或主管姓名。",
  INVALID_DIRECTOR_EMAIL: "通知信箱格式需要再確認。",
  DIRECTOR_REQUIRED: "每個面試時間都要指定一位處長或主管。",
};
