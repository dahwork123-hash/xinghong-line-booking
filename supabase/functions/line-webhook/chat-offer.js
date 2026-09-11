export const TAICHUNG_OFFICE = {
  id: "taichung",
  label: "台中分公司",
  address: "台中市北屯區文心路四段698號6樓之1",
  arrival:
    "來請直接上電梯六樓進辦公室，告知面試會先填寫履歷(請自備原子筆)，再由主管面試，如人數較多將採用團體面試。",
  weather: "(如遇到國定假/颱風假會暫停面試，請再主動來訊預約)",
};

export const DEFAULT_TAICHUNG_WEEK = {
  1: ["11:00-13:00", "14:00-16:00"],
  2: ["11:00-13:00", "14:00-16:00", "16:00-18:00"],
  3: ["10:00-12:00", "14:00-16:00", "16:00-18:00"],
  4: ["11:00-13:00", "14:00-16:00", "16:00-18:00"],
  5: ["14:00-16:00", "16:00-18:00"],
};

const DAY_ZH = ["", "一", "二", "三", "四", "五", "六", "日"];
const ZH_DAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const ZH_NUM = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export function addDays(ymd, n) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function weekday(ymd) {
  return new Date(`${ymd}T12:00:00+08:00`).getUTCDay() || 7;
}

export function shortDate(ymd) {
  const [, m, d] = String(ymd).split("-");
  return Number(m) + "/" + Number(d);
}

export function parseSlotTime(value) {
  const s = String(value || "").trim();
  const m = s.match(
    /^(([01]\d|2[0-3]):[0-5]\d)(?:\s*[-–~到至]\s*(([01]\d|2[0-3]):[0-5]\d))?$/,
  );
  if (!m) return null;
  return { start: m[1], end: m[3] || addMinutes(m[1], 120) };
}

function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return (
    String(Math.floor(t / 60)).padStart(2, "0") +
    ":" +
    String(t % 60).padStart(2, "0")
  );
}

export function zhClock(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const min = m ? m + "分" : "";
  if (h === 0) return "上午12點" + min;
  if (h < 12) return "上午" + h + "點" + min;
  if (h === 12) return "中午12點" + min;
  return "下午" + (h - 12) + "點" + min;
}

function slotsOf(isoWeekdays, day) {
  const raw = isoWeekdays?.[day] || isoWeekdays?.[String(day)] || [];
  return raw.map(parseSlotTime).filter(Boolean);
}

function compactClocks(labels) {
  if (!labels.length) return "";
  const rest = labels.slice(1).map((label) => label.replace(/^(上午|下午|中午)/, ""));
  if (!rest.length) return labels[0];
  if (rest.length === 1) return labels[0] + "或" + rest[0];
  return labels[0] + "、" + rest.slice(0, -1).join("、") + "或" + rest.at(-1);
}

function formatDayTimes(starts) {
  const morning = starts.filter((t) => t < "12:00").map(zhClock);
  const afternoon = starts.filter((t) => t >= "12:00").map(zhClock);
  const parts = [];
  if (morning.length) parts.push(compactClocks(morning));
  if (afternoon.length) parts.push(compactClocks(afternoon));
  return parts.join("、");
}

export function composeOffer(isoWeekdays = DEFAULT_TAICHUNG_WEEK, office = TAICHUNG_OFFICE) {
  const lines = ["您好，", "跟您約"];
  for (let day = 1; day <= 7; day++) {
    const starts = slotsOf(isoWeekdays, day).map((s) => s.start);
    if (!starts.length) continue;
    lines.push(`禮拜${DAY_ZH[day]}，${formatDayTimes(starts)}`);
  }
  lines.push("");
  lines.push(office.weather);
  lines.push("");
  lines.push("請問您哪個時段可以來面試呢?");
  lines.push("面試地點:");
  lines.push(`📍${office.label}：${office.address}`);
  return lines.join("\n");
}

export function composeConfirm(office = TAICHUNG_OFFICE) {
  return [
    "好的，提供您面試地點:",
    office.address,
    "",
    office.arrival,
    office.weather,
  ].join("\n");
}

export function composeReminder(date, start, office = TAICHUNG_OFFICE) {
  return [
    `您好，提醒您明天（${shortDate(date)}）${zhClock(start)}面試。`,
    `地點：${office.address}`,
    "",
    office.arrival,
    office.weather,
  ].join("\n");
}

export function looksLikeOfferRequest(text) {
  const t = String(text || "").replace(/\s+/g, "");
  if (!t) return true;
  return /您好|哈囉|你好|預約|面試|時段|請問|想約|可以面試/.test(t);
}

function parseZhInt(s) {
  const raw = String(s || "").trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === "十") return 10;
  if (raw.startsWith("十")) return 10 + (ZH_NUM[raw[1]] || 0);
  if (raw.endsWith("十") && raw.length === 2) return (ZH_NUM[raw[0]] || 0) * 10;
  if (raw.includes("十")) {
    const [a, b] = raw.split("十");
    return (ZH_NUM[a] || 0) * 10 + (ZH_NUM[b] || 0);
  }
  if (raw.length === 1 && raw in ZH_NUM) return ZH_NUM[raw];
  return null;
}

function hourToStart(hour, period) {
  if (hour == null || hour < 0 || hour > 23) return null;
  if (period === "am") {
    if (hour === 12) return "00:00";
    return String(hour).padStart(2, "0") + ":00";
  }
  if (period === "pm") {
    if (hour === 12) return "12:00";
    if (hour < 12) return String(hour + 12).padStart(2, "0") + ":00";
    return String(hour).padStart(2, "0") + ":00";
  }
  if (hour <= 9) return String(hour + 12).padStart(2, "0") + ":00";
  return String(hour).padStart(2, "0") + ":00";
}

function upcomingDate(isoDay, today, start, nowHm) {
  let delta = isoDay - weekday(today);
  if (delta < 0) delta += 7;
  let date = addDays(today, delta);
  if (delta === 0 && nowHm && start && start <= nowHm) date = addDays(today, 7);
  return date;
}

function matchSlot(slots, wanted) {
  const exact = slots.find((s) => s.start === wanted);
  if (exact) return exact;
  const hour = wanted.slice(0, 2);
  const sameHour = slots.filter((s) => s.start.startsWith(hour + ":"));
  if (sameHour.length === 1) return sameHour[0];
  return null;
}

export function parseTimeReply(
  text,
  {
    today,
    nowHm = "00:00",
    isoWeekdays = DEFAULT_TAICHUNG_WEEK,
  } = {},
) {
  const raw = String(text || "").replace(/\s+/g, "");
  if (!today) return { ok: false, reason: "NO_TIME" };

  let isoDay = null;
  if (/今天|今日/.test(raw)) isoDay = weekday(today);
  else if (/明天|明日/.test(raw)) isoDay = weekday(addDays(today, 1));
  else {
    const dayHit = raw.match(/(?:禮拜|星期|週)([一二三四五六日天])/);
    if (dayHit) isoDay = ZH_DAY[dayHit[1]];
  }

  let period = null;
  if (/早上|上午/.test(raw)) period = "am";
  else if (/下午|晚上/.test(raw)) period = "pm";

  let hour = null;
  const clock = raw.match(/(\d{1,2}):(\d{2})/);
  let wanted = null;
  if (clock) {
    wanted =
      String(Number(clock[1])).padStart(2, "0") +
      ":" +
      clock[2];
  } else {
    const point = raw.match(/([0-9一二三四五六七八九十兩]{1,3})點/);
    if (point) hour = parseZhInt(point[1]);
    wanted = hourToStart(hour, period);
  }

  if (isoDay == null || !wanted) return { ok: false, reason: "NO_TIME" };

  const slots = slotsOf(isoWeekdays, isoDay);
  if (!slots.length) return { ok: false, reason: "NO_SLOT" };

  let slot = matchSlot(slots, wanted);
  if (!slot && !period && hour != null && hour <= 9) {
    slot = matchSlot(slots, hourToStart(hour, "am"));
  }
  if (!slot) return { ok: false, reason: "NO_SLOT" };

  const date = upcomingDate(isoDay, today, slot.start, nowHm);
  return {
    ok: true,
    isoDay,
    date,
    start: slot.start,
    end: slot.end,
    label: `禮拜${DAY_ZH[isoDay]} ${zhClock(slot.start)}`,
  };
}

export function unclearTimeHelp() {
  return "抱歉，沒有對到可預約的時段。請直接回覆例如：禮拜一下午2點，謝謝。";
}

export function alreadyBookedText(date, start, office = TAICHUNG_OFFICE) {
  return [
    `您目前已預約 ${shortDate(date)}（禮拜${DAY_ZH[weekday(date)]}）${zhClock(start)}。`,
    `地點：${office.address}`,
    "若要改時間，請直接回覆新的時段，例如：禮拜一下午2點。",
  ].join("\n");
}
