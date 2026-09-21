const WEATHER = "(如遇到國定假/颱風假會暫停面試，請再主動來訊預約)";
const ARRIVAL_RESUME =
  "告知面試會先填寫履歷(請自備原子筆)，再由主管面試，如人數較多將採用團體面試。";

export const OFFICES = {
  taichung: {
    id: "taichung",
    city: "台中",
    label: "台中分公司",
    address: "台中市北屯區文心路四段698號6樓之1",
    arrival: "來請直接上電梯六樓進辦公室，" + ARRIVAL_RESUME,
    weather: WEATHER,
  },
  changhua: {
    id: "changhua",
    city: "彰化",
    label: "彰化分公司",
    address: "彰化市華山路37號11樓之4",
    arrival: "來請直接上電梯11樓進辦公室，" + ARRIVAL_RESUME,
    weather: WEATHER,
  },
  chiayi: {
    id: "chiayi",
    city: "嘉義",
    label: "嘉義分公司",
    address: "嘉義市西區上海路175號2樓",
    arrival: "來請直接上走樓梯2樓右轉進辦公室，" + ARRIVAL_RESUME,
    weather: WEATHER,
  },
  hsinchu: {
    id: "hsinchu",
    city: "新竹",
    label: "新竹分公司",
    address: "新竹縣竹北市光明五街342號2樓",
    arrival: "來請直接上電梯二樓進辦公室，" + ARRIVAL_RESUME,
    weather: WEATHER,
  },
  nantou: {
    id: "nantou",
    city: "南投",
    label: "南投（草屯）",
    address: "南投面試地點請依招募同仁通知",
    arrival: "目前南投面試地點請依招募同仁通知。之後辦公可以在草屯辦公室。",
    weather: WEATHER,
  },
  taoyuan: {
    id: "taoyuan",
    city: "桃園",
    label: "桃園分公司",
    address: "桃園面試地點請依招募同仁通知",
    arrival: "目前桃園面試地點請依招募同仁通知。",
    weather: WEATHER,
  },
};

export const TAICHUNG_OFFICE = OFFICES.taichung;
export const CITIES = ["新竹", "桃園", "台中", "彰化", "嘉義", "南投"];
export const JOBS = ["社宅顧問", "儲備主管", "行政職"];
export const CITY_TO_OFFICE = {
  新竹: "hsinchu",
  桃園: "taoyuan",
  台中: "taichung",
  彰化: "changhua",
  嘉義: "chiayi",
  南投: "nantou",
};

export const DEFAULT_TAICHUNG_WEEK = {
  1: ["11:00-13:00", "14:00-16:00"],
  2: ["11:00-13:00", "14:00-16:00", "16:00-18:00"],
  3: ["10:00-12:00", "14:00-16:00", "16:00-18:00"],
  4: ["11:00-13:00", "14:00-16:00", "16:00-18:00"],
  5: ["14:00-16:00", "16:00-18:00"],
};

export const DEFAULT_CITY_WEEKS = {
  taichung: DEFAULT_TAICHUNG_WEEK,
  changhua: { 4: ["14:00-16:00"] },
  chiayi: { 3: ["16:00-18:00"], 4: ["16:00-18:00"] },
  hsinchu: { 2: ["14:00-16:00"], 4: ["14:00-16:00"] },
  taoyuan: {},
  nantou: {},
};

export const DEFAULT_CITY_RULES = [
  { officeId: "taichung", pool: "general", capacity: 5, isoWeekdays: DEFAULT_TAICHUNG_WEEK },
  { officeId: "hsinchu", pool: "general", capacity: 5, isoWeekdays: DEFAULT_CITY_WEEKS.hsinchu },
  { officeId: "taoyuan", pool: "general", capacity: 5, isoWeekdays: DEFAULT_CITY_WEEKS.taoyuan },
  { officeId: "changhua", pool: "general", capacity: 5, isoWeekdays: DEFAULT_CITY_WEEKS.changhua },
  { officeId: "chiayi", pool: "general", capacity: 5, isoWeekdays: DEFAULT_CITY_WEEKS.chiayi },
  { officeId: "nantou", pool: "general", capacity: 5, isoWeekdays: DEFAULT_CITY_WEEKS.nantou },
];

export function officeForCity(city) {
  return OFFICES[CITY_TO_OFFICE[city]] || OFFICES.taichung;
}

export function cityOfOffice(officeId) {
  return Object.values(OFFICES).find((o) => o.id === officeId)?.city || "";
}

export function applyOfficeDetails(office, schedule) {
  const base = office || TAICHUNG_OFFICE;
  const extra = schedule?.officeDetails?.[base.id] || {};
  return {
    ...base,
    label: String(extra.label || base.label || ""),
    address: String(extra.address || base.address || ""),
    arrival: String(extra.arrival || base.arrival || ""),
  };
}

export function composeAskCity() {
  return "請問您要在哪個縣市面試？\n請回：" + CITIES.slice(0, -1).join("、") + "或" + CITIES.at(-1) + "。";
}

export function composeAskName() {
  return "請回覆您的真實姓名，方便主管聯絡。";
}

export function composeAskPhone() {
  return "請回覆您的手機號碼，例如：0912345678。";
}

export function composeAskJob() {
  return "請問您要應徵哪個職位？\n請回：" + JOBS.slice(0, -1).join("、") + "或" + JOBS.at(-1) + "。";
}

export function composeAskProfile(gap) {
  if (gap === "phone") return composeAskPhone();
  if (gap === "job") return composeAskJob();
  if (gap === "name") return composeAskName();
  return "";
}

export function normalizePhone(text) {
  const digits = String(text || "").replace(/\D/g, "");
  if (/^09\d{8}$/.test(digits)) return digits;
  if (/^8869\d{8}$/.test(digits)) return "0" + digits.slice(3);
  return "";
}

export function looksLikePersonName(text) {
  const t = String(text || "").replace(/\s+/g, "");
  if (t.length < 2 || t.length > 20) return false;
  if (CITIES.includes(t) || JOBS.includes(t)) return false;
  if (/預約|面試|取消|聯絡|常見|綁定|工作內容|薪資|工時|禮拜|星期|週[一二三四五六日]|上午|下午|晚上/.test(t)) return false;
  if (normalizePhone(t)) return false;
  if (/[A-Za-z0-9]{8,}/.test(t)) return false;
  return true;
}

export function nextProfileGap(profile = {}) {
  const p = profile || {};
  if (p.profileOk) return "";
  if (!p.namePicked) return "name";
  if (!normalizePhone(p.phone)) return "phone";
  if (!p.jobPicked) return "job";
  return "";
}

export function classifyBindText(text) {
  const t = String(text || "").replace(/\s+/g, "");
  const bind = t.match(/^(?:綁定主管|綁定)(\d{6})$/);
  if (bind) return { kind: "bind", code: bind[1] };
  if (/^(解除綁定|取消綁定)$/.test(t)) return { kind: "unbind" };
  return null;
}

export function directorById(schedule, id) {
  return (schedule?.directors || []).find((d) => d.id === id) || null;
}

export function extractCity(text) {
  const t = String(text || "").replace(/\s+/g, "");
  const hits = CITIES.filter((city) => t.includes(city));
  return hits.length === 1 ? hits[0] : "";
}

export function hasBookableSlots(isoWeekdays) {
  for (let day = 1; day <= 7; day++) {
    if (slotsOf(isoWeekdays, day).length) return true;
  }
  return false;
}

export function ruleForCity(schedule, city) {
  const officeId = officeForCity(city).id;
  const found = (schedule?.rules || []).find((r) => r.officeId === officeId);
  if (found) return found;
  return DEFAULT_CITY_RULES.find((r) => r.officeId === officeId) || DEFAULT_CITY_RULES[0];
}

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

export function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return (
    String(Math.floor(t / 60)).padStart(2, "0") +
    ":" +
    String(t % 60).padStart(2, "0")
  );
}

export function isBookable(date, start, today, nowHm) {
  if (!date || !start || !today) return false;
  if (date < today) return false;
  if (date > addDays(today, 13)) return false;
  if (date === today && nowHm && nowHm >= addMinutes(start, -60)) return false;
  return true;
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
  if (delta === 0 && !isBookable(date, start, today, nowHm)) date = addDays(today, 7);
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

export const FAQ_TEXTS = {
  work: "您好，\n我們是政府合法委託社會住宅包租代管業者，致力於推廣社會住宅政策\n服務過程不收仲介費服務費，都是由政府經費撥款\n\n工作內容\n1.社會住宅推廣解說\n2.協助民眾辦理社會住宅相關補助\n3.評估房屋市場行情\n4.協助客戶處理糾紛\n5.電話拜訪客戶了解客戶案例\n\n現場會有面試主管向您說明",
  salary: "您好，我們有底薪制(儲備培訓)、高獎金論件計酬及兼職，現場會有面試主管向您說明\n0900-1800，周休二日 見紅休",
  office: "您好，我們面試和上課，統一在北屯文心路，之後上班可以選就近的辦公室。",
  nantou: "目前面試統一在台中/彰化，之後辦公可以在草屯辦公室",
};

export function composeFaqMenu() {
  return [
    "您好，請問想了解哪一項？",
    "請回：工作內容、薪資與工時、台中辦公室、南投辦公室",
    "也可以直接回面試時段，例如：禮拜一下午2點。",
    "其他問題請回「聯絡同仁」。",
  ].join("\n");
}

export function composeHuman() {
  return "好的，這個問題由招募同仁協助您，請稍候。";
}

export function composeDirectorNotice(kind, row = {}, office = TAICHUNG_OFFICE) {
  const title =
    kind === "day" ? "【明天面試提醒】" : kind === "twoh" ? "【兩小時後面試】" : "【新面試預約】";
  const date = row.interview_date || row.date || "";
  const start = row.start_time || row.start || "";
  const when = date && start ? `${shortDate(date)}（禮拜${DAY_ZH[weekday(date)]}）${zhClock(start)}` : "";
  return [
    title,
    row.director_label ? `面試官：${row.director_label}` : "",
    `姓名：${row.name || "未填"}`,
    `手機：${row.phone || "未填"}`,
    `應徵：${row.job || "未填"}`,
    row.apply_city || row.city ? `縣市：${row.apply_city || row.city}` : "",
    when ? `時間：${when}` : "",
    office?.address ? `地點：${office.address}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeMine(booking, office = TAICHUNG_OFFICE) {
  if (!booking) {
    return "目前沒有尚未開始的有效預約。\n要預約請回「預約面試」。";
  }
  return [
    alreadyBookedText(booking.interview_date || booking.date, booking.start_time || booking.start, office),
    "若要取消，請回「取消預約」。",
  ].join("\n");
}

function customOfferFor(office, schedule, fallback) {
  const offers = schedule?.lineOffers || {};
  return String(offers[office.id] || (office.id === "taichung" ? schedule?.lineOffer || fallback : "") || fallback || "").trim();
}

function contextForCity(city, { schedule, isoWeekdays, office, customOffer } = {}) {
  const chosen = applyOfficeDetails(city ? officeForCity(city) : office || TAICHUNG_OFFICE, schedule);
  const rule = ruleForCity(schedule, chosen.city);
  return {
    office: chosen,
    isoWeekdays: rule?.isoWeekdays || isoWeekdays || DEFAULT_CITY_WEEKS[chosen.id] || {},
    custom: customOfferFor(chosen, schedule, customOffer),
    capacity: Number(rule?.capacity) || 5,
  };
}

function offerForContext(ctx) {
  if (!hasBookableSlots(ctx.isoWeekdays)) {
    return `目前${ctx.office.city}尚未排可預約時段。請改選其他縣市，或回「聯絡同仁」。`;
  }
  return ctx.custom || composeOfferGuide(ctx.isoWeekdays, ctx.office);
}

export function composeOfferGuide(isoWeekdays = DEFAULT_TAICHUNG_WEEK, office = TAICHUNG_OFFICE) {
  return [
    composeOffer(isoWeekdays, office),
    "",
    "也可以先回職務：社宅顧問 或 儲備主管。",
    "圖文選單：預約面試／我的預約／常見問題／聯絡同仁。",
  ].join("\n");
}

export function classifyLineText(text) {
  const t = String(text || "").replace(/\s+/g, "");
  if (!t || /^(預約面試|開始預約|面試預約|預約)$/.test(t)) return { kind: "offer" };
  if (/^(我的預約|查詢預約)$/.test(t)) return { kind: "mine" };
  if (/^(常見問題)$/.test(t)) return { kind: "faq" };
  if (/^(工作內容)$/.test(t)) return { kind: "faq-work" };
  if (/^(薪資與工時|薪資|工時)$/.test(t)) return { kind: "faq-salary" };
  if (/^(台中辦公室)$/.test(t)) return { kind: "faq-office" };
  if (/^(南投辦公室)$/.test(t)) return { kind: "faq-nantou" };
  if (/^(聯絡同仁|轉人工)$/.test(t)) return { kind: "human" };
  if (/^(取消預約|不能來了)$/.test(t)) return { kind: "cancel" };
  if (t === "社宅顧問" || t === "儲備主管" || t === "行政職") return { kind: "job", value: t };
  if (CITIES.includes(t)) return { kind: "city", value: t };
  if (/^0\d{8,12}$/.test(t)) return { kind: "phone", value: t };
  return { kind: "chat" };
}

export function buildLineReply({
  text,
  today,
  nowHm = "00:00",
  isoWeekdays = DEFAULT_TAICHUNG_WEEK,
  office = TAICHUNG_OFFICE,
  booking = null,
  humanMode = false,
  customOffer = "",
  applyCity = "",
  schedule = null,
  profile = null,
  pending = null,
} = {}) {
  if (humanMode) return { text: "", silent: true, actions: [] };

  const intent = classifyLineText(text);
  const args = { schedule, isoWeekdays, office, customOffer };
  const knownCity = intent.kind === "city" ? intent.value : extractCity(text) || applyCity;
  const ctx = contextForCity(knownCity, args);
  const gap = nextProfileGap(profile);
  const askCity = () => ({ text: composeAskCity(), actions: [] });
  const askGap = (next, extra = "") => ({
    text: extra + composeAskProfile(next || "name"),
    actions: [],
  });
  const afterProfile = (actions, extra, nextProfile) => {
    const next = nextProfileGap(nextProfile);
    if (next) return { text: extra + composeAskProfile(next), actions };
    if (pending) {
      const picked = { ...pending, officeId: pending.officeId || ctx.office.id, city: pending.city || ctx.office.city };
      return {
        text: extra + composeConfirm(ctx.office),
        actions: [...actions, { type: "book", picked }, { type: "clear_pending" }],
      };
    }
    if (!knownCity) return { text: extra + composeAskCity(), actions };
    return { text: extra + offerForContext(ctx), actions };
  };

  if (intent.kind === "offer") {
    return booking ? { text: composeMine(booking, ctx.office), actions: [] } : askCity();
  }
  if (intent.kind === "mine") return { text: composeMine(booking, ctx.office), actions: [] };
  if (intent.kind === "faq") return { text: composeFaqMenu(), actions: [] };
  if (intent.kind === "faq-work") return { text: FAQ_TEXTS.work, actions: [] };
  if (intent.kind === "faq-salary") return { text: FAQ_TEXTS.salary, actions: [] };
  if (intent.kind === "faq-office") return { text: FAQ_TEXTS.office, actions: [] };
  if (intent.kind === "faq-nantou") return { text: FAQ_TEXTS.nantou, actions: [] };
  if (intent.kind === "human") return { text: composeHuman(), actions: [{ type: "human" }] };
  if (intent.kind === "cancel") {
    if (!booking) return { text: composeMine(null, ctx.office), actions: [] };
    return { text: "已幫您取消這次面試。若要再約，請回「預約面試」。", actions: [{ type: "cancel" }] };
  }
  if (intent.kind === "job") {
    const nextProfile = { ...(profile || {}), job: intent.value, jobPicked: true };
    return afterProfile(
      [{ type: "touch", job: intent.value, jobPicked: true }],
      `好的，已記下應徵${intent.value}。\n\n`,
      nextProfile,
    );
  }
  if (intent.kind === "city") {
    const cityCtx = contextForCity(intent.value, args);
    const actions = [{ type: "touch", city: intent.value }];
    if (gap) return { text: `好的，已記下${intent.value}。\n\n` + composeAskProfile(gap), actions };
    return { text: offerForContext(cityCtx), actions };
  }
  if (intent.kind === "phone") {
    const phone = normalizePhone(intent.value);
    const nextProfile = { ...(profile || {}), phone, namePicked: profile?.namePicked };
    return afterProfile([{ type: "touch", phone }], `好的，已記下電話。\n\n`, nextProfile);
  }

  if (gap === "name" && looksLikePersonName(text) && intent.kind === "chat") {
    const name = String(text || "").replace(/\s+/g, "");
    return afterProfile(
      [{ type: "touch", name }],
      "好的，已記下姓名。\n\n",
      { ...(profile || {}), name, namePicked: true },
    );
  }
  if (gap === "phone" && intent.kind === "chat") {
    const phone = normalizePhone(text);
    if (phone) {
      return afterProfile(
        [{ type: "touch", phone }],
        "好的，已記下電話。\n\n",
        { ...(profile || {}), phone },
      );
    }
    return askGap("phone", "手機號碼格式請用 09 開頭的 10 碼。\n\n");
  }
  if (gap === "job" && intent.kind === "chat") {
    return askGap("job", "請從下列選一個職位。\n\n");
  }

  const picked = parseTimeReply(text, { today, nowHm, isoWeekdays: ctx.isoWeekdays });
  if (picked.ok) {
    if (!knownCity) return askCity();
    if (!isBookable(picked.date, picked.start, today, nowHm)) {
      return { text: "目前只開放含今天共14天、且開場前1小時可預約。請改選其他時段。\n\n" + (gap ? composeAskProfile(gap) : offerForContext(ctx)), actions: [] };
    }
    const slot = { ...picked, officeId: ctx.office.id, city: ctx.office.city };
    if (gap) {
      return {
        text: composeAskProfile(gap),
        actions: [{ type: "pending", picked: slot }],
      };
    }
    const actions = [{ type: "book", picked: slot }];
    if (ctx.office.city && ctx.office.city !== applyCity) {
      actions.unshift({ type: "touch", city: ctx.office.city });
    }
    return { text: composeConfirm(ctx.office), actions };
  }
  if (booking && looksLikeOfferRequest(text)) return { text: composeMine(booking, ctx.office), actions: [] };
  if (looksLikeOfferRequest(text)) return askCity();
  if (!knownCity) return { text: unclearTimeHelp() + "\n\n" + composeAskCity(), actions: [] };
  if (gap) return askGap(gap, unclearTimeHelp() + "\n\n");
  return { text: unclearTimeHelp() + "\n\n" + offerForContext(ctx), actions: [] };
}
