import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  composeOffer,
  composeConfirm,
  composeReminder,
  buildLineReply,
  officeForCity,
  OFFICES as INTERVIEW_OFFICES,
  DEFAULT_CITY_RULES,
} from "./source/src/chat-offer.js?v=combine5";

const DAY = ["", "一", "二", "三", "四", "五", "六", "日"];
const OFFICES = { taichung: "台中", hsinchu: "新竹", taoyuan: "桃園", changhua: "彰化", chiayi: "嘉義", nantou: "南投" };
const JOBS = ["社宅顧問", "儲備主管", "行政職"];
const CITIES = ["新竹", "桃園", "台中", "彰化", "嘉義", "南投"];
const SOURCES = ["104人力銀行", "1111人力銀行", "FB廣告", "其他", "未知"];
const SB = createClient(
  "https://xpbownhiedurytlyqszu.supabase.co",
  "sb_publishable__436wSaJmMI04vWqRSYAug_AQ0Jo5Lm",
);
const KEY = "xinghong-pages-board-v4";
const seed = {
  directors: [
    { id: "zhong-1", name: "黃岳澤", title: "處長", unit: "中一處", officeId: "taichung", pool: "general", notifyEmail: "", notifyLine: "" },
    { id: "zhong-2", name: "賴重丞", title: "處長", unit: "中二處", officeId: "taichung", pool: "general", notifyEmail: "", notifyLine: "" },
    { id: "zhong-3", name: "吳震", title: "處長", unit: "中三處", officeId: "taichung", pool: "general", notifyEmail: "", notifyLine: "" },
    { id: "zhong-4", name: "吳清蓮", title: "處長", unit: "中四處", officeId: "taichung", pool: "general", notifyEmail: "", notifyLine: "" },
    { id: "zhong-5", name: "童翊桓", title: "處長", unit: "中五處", officeId: "taichung", pool: "general", notifyEmail: "", notifyLine: "" },
    { id: "zhong-6", name: "蘇睿雅", title: "處長", unit: "中六處", officeId: "taichung", pool: "general", notifyEmail: "", notifyLine: "" },
  ],
  rules: structuredClone(DEFAULT_CITY_RULES),
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const addMinutes = (hhmm, minutes) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
};
const parseRange = (value) => {
  const s = String(value || "").trim();
  const m = s.match(/^(([01]\d|2[0-3]):[0-5]\d)(?:\s*[-–~到至]\s*(([01]\d|2[0-3]):[0-5]\d))?$/);
  if (!m) return { start: "", end: "" };
  return { start: m[1], end: m[3] || addMinutes(m[1], 120) };
};
const rangeLabel = (value) => {
  const p = parseRange(value);
  return p.start ? p.start + "–" + p.end : "";
};
const rangeToken = (start, end) => start + "-" + (end || addMinutes(start, 120));
const slotKey = (o, p, d, t) => o + "|" + p + "|" + d + "|" + (parseRange(t).start || t);
const color = (id) => {
  const p = ["#0f7a56", "#1d6fbf", "#b45309", "#7c3aed", "#be185d", "#0f766e"];
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return p[h % p.length];
};
const $ = (s) => document.querySelector(s);
const toast = (m) => {
  $("#toast").textContent = m;
};
const rpcError = (err) => String(err?.message || err || "");

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
function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function isoWeekday(ymd) {
  return new Date(ymd + "T12:00:00+08:00").getUTCDay() || 7;
}
function mondayOf(ymd) {
  return addDays(ymd, 1 - isoWeekday(ymd));
}
function dateForDay(weekOffset, day) {
  return addDays(mondayOf(addDays(taipeiToday(), weekOffset * 7)), day - 1);
}

const defaults = () => {
  const assignments = {};
  for (const r of seed.rules)
    for (const [day, times] of Object.entries(r.isoWeekdays))
      for (const time of times) {
        const dir = seed.directors.find((d) => d.officeId === r.officeId && d.pool === r.pool);
        if (dir) assignments[slotKey(r.officeId, r.pool, day, time)] = dir.id;
      }
  return {
    directors: structuredClone(seed.directors),
    rules: structuredClone(seed.rules),
    assignments,
    officeIndex: 0,
    slotHours: 2,
  };
};

let board = defaults();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (saved?.directors && saved?.rules) board = { ...defaults(), ...saved };
} catch {}
ensureCities(board);

let candidates = [];
let bookings = [];
let reminders = [];
let weekOffset = 0;

function ensureCities(next) {
  const have = new Set((next.rules || []).map((r) => r.officeId));
  let added = false;
  for (const extra of DEFAULT_CITY_RULES) {
    if (!have.has(extra.officeId)) {
      next.rules.push(structuredClone(extra));
      added = true;
    }
  }
  const order = DEFAULT_CITY_RULES.map((r) => r.officeId);
  next.rules.sort((a, b) => order.indexOf(a.officeId) - order.indexOf(b.officeId));
  if (next.officeIndex >= next.rules.length) next.officeIndex = 0;
  next.lineOffers = next.lineOffers || {};
  return added;
}

const persist = (quiet) => {
  localStorage.setItem(KEY, JSON.stringify(board));
  if (!quiet) {
    toast(
      currentOfferSaved()
        ? "時間表已更新。約訪文案仍用你改過的版本。"
        : "時間表已更新。LINE 約訪訊息會跟這份時段走。",
    );
  }
  guarded(async () => {
    await rpc("xinghong_save_schedule", { p_value: board });
  });
};
const group = (r) => board.directors.filter((d) => d.officeId === r.officeId && d.pool === r.pool);
const directorLabel = (id) => {
  const d = board.directors.find((x) => x.id === id);
  return d ? [d.unit, d.name].filter(Boolean).join(" ") : "";
};
const slotBookings = (date, start) =>
  bookings.filter((b) => b.interview_date === date && b.start_time === start);
const activeBooking = (candidateId) =>
  bookings.find((b) => b.candidate_id === candidateId && b.interview_date >= taipeiToday());

async function rpc(name, args = {}) {
  const { data, error } = await SB.rpc(name, args);
  if (error) throw error;
  return data;
}

async function loadCloud() {
  try {
    const data = await rpc("xinghong_board");
    candidates = data?.candidates || [];
    bookings = data?.bookings || [];
    if (data?.schedule?.directors && data?.schedule?.rules) {
      board = { ...defaults(), ...data.schedule };
      const added = ensureCities(board);
      localStorage.setItem(KEY, JSON.stringify(board));
      if (added) await rpc("xinghong_save_schedule", { p_value: board });
    } else {
      ensureCities(board);
      await rpc("xinghong_save_schedule", { p_value: board });
    }
    reminders = (await rpc("xinghong_due_reminders")) || [];
  } catch (e) {
    toast("讀取面試者失敗：" + rpcError(e));
  }
}

const HOURS = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];
let selectedDir = null;
let drag = null;
let justDragged = false;

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function weekdays() {
  return board.rules[board.officeIndex]?.isoWeekdays || {};
}
function currentOfficeId() {
  return board.rules[board.officeIndex]?.officeId || "taichung";
}
function currentOffice() {
  return INTERVIEW_OFFICES[currentOfficeId()] || INTERVIEW_OFFICES.taichung;
}
function savedOfferText() {
  const id = currentOfficeId();
  return String((board.lineOffers && board.lineOffers[id]) || (id === "taichung" ? board.lineOffer : "") || "").trim();
}
function currentOfferSaved() {
  return Boolean(savedOfferText());
}
function offerText() {
  return savedOfferText() || composeOffer(weekdays(), currentOffice());
}

function slotSpan(time) {
  const p = parseRange(time);
  return Math.max(1, Math.round((minutesOf(p.end) - minutesOf(p.start)) / 60));
}

function clampEnd(start, hours) {
  let end = addMinutes(start, hours * 60);
  if (end > "18:00") end = "18:00";
  return end > start ? end : "";
}

function slotConflict(day, start, end, ignoreTime) {
  const r = board.rules[board.officeIndex];
  return (r.isoWeekdays[day] || []).some((time) => {
    if (time === ignoreTime) return false;
    const p = parseRange(time);
    return p.start < end && start < p.end;
  });
}

function assignDirectorToCell(day, hour, directorId) {
  const r = board.rules[board.officeIndex];
  const dir = board.directors.find((d) => d.id === directorId);
  if (!dir) return;
  const covering = (r.isoWeekdays[day] || []).find((time) => {
    const p = parseRange(time);
    return p.start <= hour && hour < p.end;
  });
  if (covering) {
    board.assignments[slotKey(r.officeId, r.pool, day, covering)] = dir.id;
    persist();
    render();
    toast(`${dir.name} 改排在星期${DAY[day]} ${rangeLabel(covering)}。`);
    return;
  }
  const hours = board.slotHours === 1 ? 1 : 2;
  const end = clampEnd(hour, hours);
  if (!end) {
    toast("這個鐘點無法再加時段。");
    return;
  }
  if (slotConflict(day, hour, end)) {
    toast("此時段跟已有的格子重疊，請改拉到空白格。");
    return;
  }
  const time = rangeToken(hour, end);
  r.isoWeekdays[day] = [...(r.isoWeekdays[day] || []), time].sort();
  board.assignments[slotKey(r.officeId, r.pool, day, time)] = dir.id;
  persist();
  render();
  toast(`${dir.name} 已排進星期${DAY[day]} ${hour}–${end}。`);
}

function relocateSlot(fromDay, fromTime, toDay, toHour) {
  const r = board.rules[board.officeIndex];
  const p = parseRange(fromTime);
  if (fromDay === toDay && p.start === toHour) return;
  const covering = (r.isoWeekdays[toDay] || []).find((time) => {
    const q = parseRange(time);
    return q.start <= toHour && toHour < q.end;
  });
  const dirId = board.assignments[slotKey(r.officeId, r.pool, fromDay, fromTime)];
  if (covering) {
    if (dirId) assignDirectorToCell(toDay, toHour, dirId);
    return;
  }
  const end = clampEnd(toHour, slotSpan(fromTime));
  if (!end) {
    toast("這個鐘點無法再放時段。");
    return;
  }
  if (slotConflict(toDay, toHour, end, fromDay === toDay ? fromTime : "")) {
    toast("此時段跟已有的格子重疊，請改拉到空白格。");
    return;
  }
  r.isoWeekdays[fromDay] = (r.isoWeekdays[fromDay] || []).filter((t) => t !== fromTime);
  delete board.assignments[slotKey(r.officeId, r.pool, fromDay, fromTime)];
  const next = rangeToken(toHour, end);
  r.isoWeekdays[toDay] = [...(r.isoWeekdays[toDay] || []), next].sort();
  if (dirId) board.assignments[slotKey(r.officeId, r.pool, toDay, next)] = dirId;
  persist();
  render();
  const dir = board.directors.find((d) => d.id === dirId);
  toast(`${dir?.name || "此時段"} 已改到星期${DAY[toDay]} ${toHour}–${end}。`);
}

function resizeSlot(day, time) {
  const r = board.rules[board.officeIndex];
  const p = parseRange(time);
  const nextHours = slotSpan(time) <= 1 ? 2 : 1;
  const end = clampEnd(p.start, nextHours);
  if (!end) {
    toast("無法再加長這個時段。");
    return;
  }
  if (slotConflict(day, p.start, end, time)) {
    toast("加長後會跟隔壁時段重疊。");
    return;
  }
  const next = rangeToken(p.start, end);
  r.isoWeekdays[day] = (r.isoWeekdays[day] || []).map((t) => (t === time ? next : t)).sort();
  const key = slotKey(r.officeId, r.pool, day, time);
  const dirId = board.assignments[key];
  delete board.assignments[key];
  if (dirId) board.assignments[slotKey(r.officeId, r.pool, day, next)] = dirId;
  persist();
  render();
}

function renderSlotGrid(r) {
  const heads =
    `<div class="grid-corner"></div>` +
    [1, 2, 3, 4, 5, 6, 7]
      .map((d) => `<div class="grid-head">星期${DAY[d]}<small>${dateForDay(weekOffset, d).slice(5)}</small></div>`)
      .join("");
  const body = HOURS.map((hour, i) => {
    const cells = [1, 2, 3, 4, 5, 6, 7]
      .map((day) => {
        const started = (r.isoWeekdays[day] || []).find((t) => parseRange(t).start === hour);
        if (started) {
          const span = slotSpan(started);
          const start = parseRange(started).start;
          const dir =
            board.directors.find((d) => d.id === board.assignments[slotKey(r.officeId, r.pool, day, started)]) ||
            group(r)[0];
          const seated = slotBookings(dateForDay(weekOffset, day), start);
          const names = seated.map((b) => candidates.find((c) => c.id === b.candidate_id)?.name || "面試者").join("、");
          return `<div class="grid-fill" data-drop-cell="${day}|${hour}" data-slot-time="${esc(started)}" data-act="open-slot" data-id="${day}|${esc(started)}" style="grid-column:${day + 1};grid-row:${i + 2} / span ${span};background:${color(dir?.id || "x")}"><button type="button" class="grid-x" data-act="remove-slot" data-id="${day}|${esc(started)}" aria-label="移除時段">×</button><b>${esc(dir?.name || "尚未指定")}</b><small>${esc([dir?.unit, rangeLabel(started)].filter(Boolean).join(" · "))}</small><span class="count">${seated.length}/${r.capacity}${names ? " · " + esc(names) : ""}</span><button type="button" class="grid-len" data-act="slot-len" data-id="${day}|${esc(started)}">${span <= 1 ? "改2小時" : "改1小時"}</button></div>`;
        }
        const covered = (r.isoWeekdays[day] || []).some((t) => {
          const p = parseRange(t);
          return p.start < hour && hour < p.end;
        });
        if (covered) return "";
        return `<button type="button" class="grid-cell" data-act="place-slot" data-drop-cell="${day}|${hour}" data-id="${day}|${hour}" style="grid-column:${day + 1};grid-row:${i + 2}" aria-label="星期${DAY[day]} ${hour}"></button>`;
      })
      .join("");
    return `<div class="grid-hour" style="grid-column:1;grid-row:${i + 2}">${esc(hour)}</div>${cells}`;
  }).join("");
  const tray = group(r).length
    ? group(r)
        .map(
          (d) =>
            `<button type="button" class="drag-chip${selectedDir === d.id ? " selected" : ""}" data-act="pick-dir" data-id="${esc(d.id)}" data-drag-dir="${esc(d.id)}" style="background:${color(d.id)}">${esc(d.unit || d.title)} ${esc(d.name)}</button>`,
        )
        .join("")
    : `<p class="hint-card">${esc(OFFICES[r.officeId] || "")}還沒有處長姓名，請先在下面「新增處長或主管」。不要先填猜測的姓名。</p>`;
  const hours = board.slotHours === 1 ? 1 : 2;
  return `<div class="director-tray"><div class="tray-row">${tray}</div><div class="len-switch"><span>拉進去的新時段</span><button type="button" data-act="slot-hours" data-id="1" class="${hours === 1 ? "active" : ""}">1小時</button><button type="button" data-act="slot-hours" data-id="2" class="${hours === 2 ? "active" : ""}">2小時</button></div><p>把處長拉進格子，或先點姓名再點格子。那個時段就由他面試。已排的格子可改 1／2 小時；沒在選處長時，點格子可排面試者。</p></div><div class="slot-grid-wrap"><div class="slot-grid">${heads}${body}</div></div>`;
}

function directorForCityDayTime(officeId, day, start) {
  const r = board.rules.find((x) => x.officeId === officeId) || board.rules[board.officeIndex];
  const time = (r.isoWeekdays[day] || r.isoWeekdays[String(day)] || []).find((t) => parseRange(t).start === start) || start;
  return (
    board.directors.find((d) => d.id === board.assignments[slotKey(r.officeId, r.pool, day, time)]) ||
    group(r)[0]
  );
}

function directorForDayTime(day, start) {
  return directorForCityDayTime(currentOfficeId(), day, start);
}

async function copyText(text, ok) {
  await navigator.clipboard.writeText(text);
  toast(ok);
}

function render() {
  const r = board.rules[board.officeIndex];
  const people = board.directors
    .filter((d) => d.officeId === r.officeId)
    .map(
      (d) => `<article class="person-card"><div class="person-top"><span class="avatar" style="background:${color(d.id)}">${esc(d.name.slice(0, 1))}</span><div><strong>${esc(d.name)}</strong><span class="meta">${esc(d.unit || d.title)} · ${esc(OFFICES[d.officeId])} · ${d.pool === "admin" ? "行政" : "一般職缺"}</span></div></div><div class="notify">${d.notifyEmail || d.notifyLine ? esc([d.notifyEmail, d.notifyLine].filter(Boolean).join(" · ")) : "還沒填通知方式"}</div><div class="actions"><button data-act="edit-dir" data-id="${esc(d.id)}">改姓名／通知</button></div></article>`,
    )
    .join("");
  const rows = candidates
    .map((c) => {
      const b = activeBooking(c.id);
      const when = b ? `${b.interview_date} ${b.start_time}–${b.end_time}` : "尚未安排";
      const lineMeta = [c.line_name, c.line_user_id].filter(Boolean).join(" · ");
      return `<tr><td><strong>${esc(c.name)}</strong><small>${esc(c.phone || "未填電話")}</small>${lineMeta ? `<small>LINE ${esc(lineMeta)}</small>` : ""}${c.line_mode === "human" ? `<small class="human-flag">人工接手中，機器人已停</small>` : ""}</td><td>${esc(c.job)}<small>${esc(c.apply_city)} · ${esc(c.source)}</small></td><td>${esc(when)}<small>${esc(b?.director_label || "")}${b?.booked_via === "line" ? " · LINE自動預約" : ""}</small></td><td>${b ? `<button data-act="cancel-booking" data-id="${esc(b.id)}">取消預約</button>` : `<button class="primary" data-act="pick-slot" data-id="${esc(c.id)}">安排時段</button>`}${c.line_mode === "human" && c.line_user_id ? `<button data-act="resume-auto" data-id="${esc(c.line_user_id)}">恢復自動</button>` : ""}<button data-act="edit-candidate" data-id="${esc(c.id)}">改資料</button></td></tr>`;
    })
    .join("");
  const weekLabel = dateForDay(weekOffset, 1) + " ～ " + dateForDay(weekOffset, 7);
  const offer = offerText();
  const remindRows = (reminders || [])
    .map(
      (item) =>
        `<li><strong>${esc(item.line_name || item.name)}</strong> ${esc(item.start_time)}–${esc(item.end_time)}<small>LINE名稱 ${esc(item.line_name || "未填")} · User ID ${esc(item.line_user_id || "尚無")}${item.reminder_sent_at ? " · 已提醒" : ""}</small></li>`,
    )
    .join("");
  const officePills = board.rules
    .map(
      (rule, i) =>
        `<button type="button" class="${i === board.officeIndex ? "active" : ""}" data-act="office" data-id="${i}">${esc(OFFICES[rule.officeId] || rule.officeId)}</button>`,
    )
    .join("");
  const lineBox = `<div class="line-card"><h2>自動回 LINE 的訊息</h2><p>求職者回「預約面試」會先問縣市，再看到下面這段「${esc(OFFICES[currentOfficeId()] || "")}」的約訪文案。可以直接改文字；改完按「儲存約訪文案」。要跟上面格子同步時，再按「從時間表重新產生」。</p><textarea id="line-offer" class="line-copy" maxlength="4900">${esc(offer)}</textarea><div class="line-actions"><button class="primary" data-act="save-offer">儲存約訪文案</button><button data-act="reset-offer">從時間表重新產生</button><button data-act="copy-offer">複製約訪訊息</button><button data-act="copy-confirm">複製地址回覆</button><button data-act="sim-reply">模擬求職者回覆</button></div>${remindRows ? `<h3>明天要提醒</h3><pre class="line-copy">${esc(composeReminder(reminders[0].interview_date, reminders[0].start_time, officeForCity(reminders[0].apply_city || "台中")))}</pre><ul class="remind-list">${remindRows}</ul>` : `<p class="hint-card">明天沒有已排定的面試，因此不會發提醒。</p>`}<p class="hint-card">LINE Webhook：https://xpbownhiedurytlyqszu.supabase.co/functions/v1/line-webhook</p></div>`;
  $("#app").innerHTML = `<div class="studio"><div class="studio-hero"><h1>面試者與面試時間</h1><p>先選縣市，再把處長拉進格子。約訪文案可在下面手動改，存檔後 LINE 會用那一段。</p></div><div class="week-toolbar"><div class="office-pills">${officePills}</div><div class="week-switch"><button data-act="week" data-id="${weekOffset - 1}">上一週</button><strong>${esc(weekLabel)}</strong><button data-act="week" data-id="${weekOffset + 1}">下一週</button></div><label>這個組每場最多幾人<input id="cap" type="number" min="1" max="99" value="${r.capacity}"></label></div>${renderSlotGrid(r)}${lineBox}<div class="candidate-panel"><div class="candidate-toolbar"><h2>面試者</h2><button class="primary" data-act="add-candidate">＋ 新增面試者</button><small>${candidates.length} 人 · 已安排 ${bookings.filter((b) => b.interview_date >= taipeiToday()).length} 場</small></div>${candidates.length ? `<table class="candidate-table"><thead><tr><th>姓名／LINE</th><th>職缺</th><th>面試時間</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p>還沒有面試者。求職者在 LINE 回時間後會出現在這裡，也可以按「新增面試者」手動填。</p>`}</div><div class="people-grid">${people}<button class="person-add" data-act="add-dir">＋ 新增處長或主管</button></div><div class="studio-foot"><button class="primary" data-act="save">儲存時間表</button><button data-act="reset">回復預設時段</button><small>時間表與面試者都在雲端，LINE 回覆會用這份時段。</small></div></div>`;
}

function modal(html) {
  $("#dialog-body").innerHTML = html;
  $("#dialog").showModal();
}

function dirForm(d) {
  const r = board.rules[board.officeIndex];
  modal(
    `<h2>${d ? "修改處長資料" : "新增處長或主管"}</h2><form id="dir-form" data-id="${esc(d?.id || "")}"><label>姓名<input name="name" value="${esc(d?.name || "")}" maxlength="40" required></label><label>處別／單位<input name="unit" value="${esc(d?.unit || "")}" maxlength="20" placeholder="例如：中一處"></label><label>職稱<select name="title">${["處長", "主管", "面試官"].map((t) => `<option ${t === (d?.title || "處長") ? "selected" : ""}>${t}</option>`).join("")}</select></label><label>面試地<select name="officeId">${Object.entries(OFFICES).map(([id, n]) => `<option value="${id}" ${id === (d?.officeId || r.officeId) ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>面試哪一組<select name="pool"><option value="general" ${(d?.pool || r.pool) === "general" ? "selected" : ""}>一般職缺</option><option value="admin" ${(d?.pool || r.pool) === "admin" ? "selected" : ""}>行政</option></select></label><label>通知信箱<input name="notifyEmail" type="email" value="${esc(d?.notifyEmail || "")}"></label><button class="primary">儲存這位處長</button></form>`,
  );
}

function slotForm(day, time) {
  const r = board.rules[board.officeIndex];
  const range = parseRange(time || "14:00");
  const current = board.assignments[slotKey(r.officeId, r.pool, day, time || range.start)] || group(r)[0]?.id || "";
  modal(
    `<h2>${time ? "調整這個時段" : "新增面試時間"}</h2><form id="slot-form" data-day="${day}" data-time="${esc(time || "")}"><label>開始時間<input name="start" type="time" value="${esc(range.start)}" required></label><label>結束時間<input name="end" type="time" value="${esc(range.end)}" required></label><label>這場由誰面試<select name="directorId">${group(r).map((d) => `<option value="${esc(d.id)}" ${d.id === current ? "selected" : ""}>${esc([d.unit, d.name].filter(Boolean).join(" "))}</option>`).join("")}</select></label>${time ? `<button type="button" class="danger" data-act="remove-slot" data-id="${day}|${time}">刪掉這個時段</button>` : ""}<button class="primary">${time ? "更新時段" : "加入時間表"}</button></form>`,
  );
}

function candidateForm(c) {
  modal(
    `<h2>${c ? "修改面試者" : "新增面試者"}</h2><form id="candidate-form" data-id="${esc(c?.id || "")}"><label>姓名<input name="name" value="${esc(c?.name || "")}" maxlength="80" required></label><label>電話<input name="phone" value="${esc(c?.phone || "")}" maxlength="20" placeholder="09xxxxxxxx"></label><label>LINE 名稱<input name="line_name" value="${esc(c?.line_name || "")}" maxlength="80" placeholder="對方的 LINE 顯示名稱"></label><label>LINE User ID<input name="line_user_id" value="${esc(c?.line_user_id || "")}" maxlength="80" placeholder="接上機器人後會自動寫入"></label><label>應徵職務<select name="job">${JOBS.map((j) => `<option ${j === (c?.job || "社宅顧問") ? "selected" : ""}>${j}</option>`).join("")}</select></label><label>應徵縣市<select name="apply_city">${CITIES.map((j) => `<option ${j === (c?.apply_city || "台中") ? "selected" : ""}>${j}</option>`).join("")}</select></label><label>來源<select name="source">${SOURCES.map((j) => `<option ${j === (c?.source || "未知") ? "selected" : ""}>${j}</option>`).join("")}</select></label><label>備註<textarea name="notes" maxlength="500">${esc(c?.notes || "")}</textarea></label><button class="primary">存到雲端</button></form>`,
  );
}

function simReplyForm() {
  modal(
    `<h2>模擬求職者回覆</h2><p>可測自然語句，也可測「預約面試／我的預約／常見問題／聯絡同仁／取消預約」。</p><form id="sim-form"><label>LINE 名稱<input name="line_name" maxlength="80" required placeholder="例如：小美"></label><label>LINE User ID<input name="line_user_id" maxlength="80" required placeholder="Uxxxxxxxx"></label><label>對方回覆<textarea name="text" maxlength="500" required>您好，禮拜一下午2點可以，謝謝</textarea></label><button class="primary">送出這則回覆</button></form>`,
  );
}

function openSlot(day, time, preselect) {
  const r = board.rules[board.officeIndex];
  const range = parseRange(time);
  const date = dateForDay(weekOffset, day);
  const dir =
    board.directors.find((d) => d.id === board.assignments[slotKey(r.officeId, r.pool, day, time)]) || group(r)[0];
  const seated = slotBookings(date, range.start);
  const free = candidates.filter((c) => !activeBooking(c.id));
  const list = seated
    .map((b) => {
      const c = candidates.find((x) => x.id === b.candidate_id);
      return `<li>${esc(c?.name || "面試者")} ${esc(c?.phone || "")} <button type="button" class="danger" data-act="cancel-booking" data-id="${esc(b.id)}">取消</button></li>`;
    })
    .join("");
  modal(
    `<h2>${date}（星期${DAY[day]}） ${esc(rangeLabel(time))}</h2><p>${esc([dir?.unit, dir?.name].filter(Boolean).join(" ") || "尚未指定處長")} · 已排 ${seated.length}/${r.capacity}</p>${list ? `<ul>${list}</ul>` : "<p>這場還沒有人。</p>"}<form id="assign-form" data-day="${day}" data-time="${esc(time)}" data-date="${date}"><label>把誰排進來<select name="candidateId">${free.length ? free.map((c) => `<option value="${esc(c.id)}" ${c.id === preselect ? "selected" : ""}>${esc(c.name)} ${esc(c.phone || "")}</option>`).join("") : "<option value=''>請先新增面試者</option>"}</select></label><button class="primary" ${free.length ? "" : "disabled"}>排進這個時段</button></form><p><button type="button" data-act="add-candidate">＋ 新增面試者</button> <button type="button" data-act="edit-slot" data-id="${day}|${time}">改時間／處長</button></p>`,
  );
}

function pickSlot(candidateId) {
  const r = board.rules[board.officeIndex];
  const options = [];
  for (let w = 0; w <= 1; w++)
    for (let day = 1; day <= 7; day++)
      for (const time of r.isoWeekdays[day] || []) {
        const date = dateForDay(w, day);
        if (date < taipeiToday()) continue;
        const start = parseRange(time).start;
        const n = slotBookings(date, start).length;
        if (n >= r.capacity) continue;
        const dir =
          board.directors.find((d) => d.id === board.assignments[slotKey(r.officeId, r.pool, day, time)]) ||
          group(r)[0];
        options.push({ date, day, time, start, n, dir });
      }
  modal(
    `<h2>安排面試時間</h2><form id="pick-form" data-id="${esc(candidateId)}"><label>選擇時段<select name="slot" required>${options.map((o) => `<option value="${o.date}|${o.day}|${esc(o.time)}">${o.date} 星期${DAY[o.day]} ${rangeLabel(o.time)} · ${esc([o.dir?.unit, o.dir?.name].filter(Boolean).join(" ") || "未指定")} · ${o.n}/${r.capacity}</option>`).join("")}</select></label><button class="primary">確認安排</button></form>`,
  );
}

document.addEventListener("click", (e) => {
  if (justDragged) {
    justDragged = false;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act,
    v = b.dataset.id;
  if (a === "week") {
    weekOffset = Number(v);
    render();
    return;
  }
  if (a === "office") {
    board.officeIndex = Number(v);
    selectedDir = null;
    persist(true);
    render();
    return;
  }
  if (a === "add-dir") return dirForm();
  if (a === "edit-dir") return dirForm(board.directors.find((d) => d.id === v));
  if (a === "pick-dir") {
    selectedDir = selectedDir === v ? null : v;
    const dir = board.directors.find((d) => d.id === selectedDir);
    toast(dir ? `已選${dir.name}，再點格子或拉進格子。` : "已取消選取。");
    render();
    return;
  }
  if (a === "place-slot") {
    if (!selectedDir) {
      toast("先點上面的處長姓名，再點要面試的格子。");
      return;
    }
    const [day, hour] = v.split("|");
    assignDirectorToCell(Number(day), hour, selectedDir);
    return;
  }
  if (a === "slot-hours") {
    board.slotHours = Number(v) === 1 ? 1 : 2;
    persist(true);
    render();
    return;
  }
  if (a === "slot-len") {
    const [day, time] = v.split("|");
    resizeSlot(Number(day), time);
    return;
  }
  if (a === "add-slot") return slotForm(Number(v));
  if (a === "edit-slot") {
    const [day, time] = v.split("|");
    return slotForm(Number(day), time);
  }
  if (a === "open-slot") {
    const [day, time] = v.split("|");
    if (selectedDir) {
      assignDirectorToCell(Number(day), parseRange(time).start, selectedDir);
      return;
    }
    return openSlot(Number(day), time);
  }
  if (a === "add-candidate") return candidateForm();
  if (a === "edit-candidate") return candidateForm(candidates.find((c) => c.id === v));
  if (a === "pick-slot") return pickSlot(v);
  if (a === "copy-offer") {
    copyText(offerText(), "已複製約訪訊息。");
    return;
  }
  if (a === "save-offer") {
    const typed = ($("#line-offer")?.value || "").trim();
    const id = currentOfficeId();
    board.lineOffers = board.lineOffers || {};
    board.lineOffers[id] = typed;
    if (id === "taichung") board.lineOffer = typed;
    persist(true);
    toast("約訪文案已存到雲端。求職者選這個縣市後會看到這段。");
    return;
  }
  if (a === "reset-offer") {
    const id = currentOfficeId();
    board.lineOffers = board.lineOffers || {};
    delete board.lineOffers[id];
    if (id === "taichung") board.lineOffer = "";
    persist(true);
    toast("已改回依時間表產生的約訪文案。");
    render();
    return;
  }
  if (a === "copy-confirm") {
    copyText(composeConfirm(currentOffice()), "已複製地址回覆。");
    return;
  }
  if (a === "sim-reply") return simReplyForm();
  if (a === "resume-auto") {
    guarded(async () => {
      await rpc("xinghong_set_line_mode", { p_line_user_id: v, p_mode: "auto", p_line_name: "" });
      await loadCloud();
      toast("已恢復自動回覆。");
      render();
    });
    return;
  }
  if (a === "remove-slot") {
    const r = board.rules[board.officeIndex],
      [day, time] = v.split("|");
    r.isoWeekdays[day] = (r.isoWeekdays[day] || []).filter((t) => t !== time);
    delete board.assignments[slotKey(r.officeId, r.pool, day, time)];
    if ($("#dialog").open) $("#dialog").close();
    persist();
    render();
    return;
  }
  if (a === "save") persist();
  if (a === "reset") {
    board = defaults();
    persist();
    toast("已回復預設時間表。");
    render();
  }
  if (a === "cancel-booking") {
    guarded(async () => {
      await rpc("xinghong_cancel", { p_booking_id: v });
      await loadCloud();
      $("#dialog").close();
      toast("已刪除這筆預約。");
      render();
    });
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "cap") {
    board.rules[board.officeIndex].capacity = Number(e.target.value);
    persist(true);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "line-offer") {
    const id = currentOfficeId();
    board.lineOffers = board.lineOffers || {};
    board.lineOffers[id] = e.target.value;
    if (id === "taichung") board.lineOffer = e.target.value;
  }
});

function guarded(fn) {
  Promise.resolve()
    .then(fn)
    .catch((err) => toast(rpcError(err)));
}

document.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target,
    data = Object.fromEntries(new FormData(f));
  if (f.id === "dir-form") {
    if (data.pool === "admin" && data.officeId !== "taichung") {
      toast("行政面試固定在台中。");
      return;
    }
    const next = {
      id: f.dataset.id || crypto.randomUUID(),
      name: data.name.trim(),
      title: data.title,
      unit: data.unit || "",
      officeId: data.officeId,
      pool: data.pool,
      notifyEmail: data.notifyEmail || "",
      notifyLine: "",
    };
    const i = board.directors.findIndex((d) => d.id === next.id);
    if (i >= 0) board.directors[i] = next;
    else board.directors.push(next);
    $("#dialog").close();
    persist();
    render();
  }
  if (f.id === "slot-form") {
    const r = board.rules[board.officeIndex],
      day = f.dataset.day,
      oldTime = f.dataset.time,
      start = String(data.start || "").slice(0, 5),
      end = String(data.end || "").slice(0, 5),
      time = rangeToken(start, end);
    if (!parseRange(start).start || !end || end <= start) {
      toast("請填開始與結束時間，例如 14:00 到 16:00。");
      return;
    }
    r.isoWeekdays[day] = r.isoWeekdays[day] || [];
    if (oldTime && oldTime !== time) {
      r.isoWeekdays[day] = r.isoWeekdays[day].filter((t) => t !== oldTime);
      delete board.assignments[slotKey(r.officeId, r.pool, day, oldTime)];
    }
    if (!r.isoWeekdays[day].includes(time)) r.isoWeekdays[day] = [...r.isoWeekdays[day], time].sort();
    board.assignments[slotKey(r.officeId, r.pool, day, time)] = data.directorId;
    $("#dialog").close();
    persist();
    render();
  }
  if (f.id === "candidate-form") {
    guarded(async () => {
      await rpc("xinghong_save_candidate", {
        p_id: f.dataset.id || null,
        p_name: data.name,
        p_phone: data.phone || "",
        p_job: data.job,
        p_apply_city: data.apply_city,
        p_source: data.source,
        p_notes: data.notes || "",
        p_line_user_id: data.line_user_id || null,
        p_line_name: data.line_name || "",
      });
      await loadCloud();
      $("#dialog").close();
      toast("面試者已存到雲端。");
      render();
    });
  }
  if (f.id === "assign-form") {
    const r = board.rules[board.officeIndex],
      day = Number(f.dataset.day),
      time = f.dataset.time,
      date = f.dataset.date,
      range = parseRange(time),
      dir =
        board.directors.find((d) => d.id === board.assignments[slotKey(r.officeId, r.pool, day, time)]) ||
        group(r)[0];
    if (!data.candidateId) {
      toast("請先新增面試者。");
      return;
    }
    guarded(async () => {
      await rpc("xinghong_assign", {
        p_candidate_id: data.candidateId,
        p_date: date,
        p_start: range.start,
        p_end: range.end,
        p_director_id: dir?.id || "",
        p_director_label: directorLabel(dir?.id || ""),
        p_capacity: r.capacity,
      });
      await loadCloud();
      $("#dialog").close();
      toast("已排進此時段。");
      render();
    });
  }
  if (f.id === "pick-form") {
    const r = board.rules[board.officeIndex];
    const [date, day, time] = String(data.slot || "").split("|");
    const range = parseRange(time);
    const dir =
      board.directors.find((d) => d.id === board.assignments[slotKey(r.officeId, r.pool, Number(day), time)]) ||
      group(r)[0];
    guarded(async () => {
      await rpc("xinghong_assign", {
        p_candidate_id: f.dataset.id,
        p_date: date,
        p_start: range.start,
        p_end: range.end,
        p_director_id: dir?.id || "",
        p_director_label: directorLabel(dir?.id || ""),
        p_capacity: r.capacity,
      });
      await loadCloud();
      $("#dialog").close();
      toast("已排進此時段。");
      render();
    });
  }
  if (f.id === "sim-form") {
    const current = bookings.find((b) => {
      const c = candidates.find((x) => x.line_user_id === data.line_user_id);
      return c && b.candidate_id === c.id && b.interview_date >= taipeiToday();
    });
    const person = candidates.find((c) => c.line_user_id === data.line_user_id);
    const result = buildLineReply({
      text: data.text,
      today: taipeiToday(),
      nowHm: taipeiNowHm(),
      schedule: board,
      applyCity: person?.apply_city || "",
      booking: current || null,
      humanMode: person?.line_mode === "human",
    });
    if (result.silent) {
      toast("這位求職者正在人工接手，機器人不會回。請先按恢復自動。");
      return;
    }
    guarded(async () => {
      for (const action of result.actions || []) {
        if (action.type === "human") {
          await rpc("xinghong_set_line_mode", {
            p_line_user_id: data.line_user_id,
            p_mode: "human",
            p_line_name: data.line_name,
          });
        }
        if (action.type === "cancel") await rpc("xinghong_cancel_by_line", { p_line_user_id: data.line_user_id });
        if (action.type === "touch") {
          await rpc("xinghong_touch_line", {
            p_line_user_id: data.line_user_id,
            p_line_name: data.line_name,
            p_job: action.job || null,
            p_apply_city: action.city || null,
            p_phone: action.phone || null,
          });
        }
        if (action.type === "book") {
          const officeId = action.picked.officeId || officeForCity(person?.apply_city || "").id;
          const r = board.rules.find((x) => x.officeId === officeId) || board.rules[board.officeIndex];
          const dir = directorForCityDayTime(officeId, action.picked.isoDay, action.picked.start);
          await rpc("xinghong_line_book", {
            p_line_user_id: data.line_user_id,
            p_line_name: data.line_name,
            p_date: action.picked.date,
            p_start: action.picked.start,
            p_end: action.picked.end,
            p_director_id: dir?.id || "",
            p_director_label: directorLabel(dir?.id || ""),
            p_capacity: r.capacity,
          });
        }
      }
      await loadCloud();
      $("#dialog").close();
      toast(result.text.split("\n")[0] || "已處理這則回覆。");
      render();
    });
  }
});

function clearDropOver() {
  document.querySelectorAll(".over").forEach((el) => el.classList.remove("over"));
}

function dropCellAt(x, y) {
  const ghost = document.querySelector(".drag-ghost");
  if (ghost) ghost.style.visibility = "hidden";
  const el = document.elementFromPoint(x, y);
  if (ghost) ghost.style.visibility = "visible";
  return el?.closest("[data-drop-cell]") || null;
}

function endDrag() {
  document.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
  document.querySelector(".drag-ghost")?.remove();
  document.body.classList.remove("is-dragging");
  clearDropOver();
  drag = null;
}

function beginDrag(e, source) {
  if (source.ghost) return;
  source.ghost = document.createElement("div");
  source.ghost.className = "drag-ghost";
  source.ghost.textContent = source.label;
  source.ghost.style.background = source.color;
  document.body.appendChild(source.ghost);
  source.chip.classList.add("dragging");
  document.body.classList.add("is-dragging");
  try {
    source.chip.setPointerCapture(e.pointerId);
  } catch {}
}

function updateDrag(e) {
  if (!drag) return;
  const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
  if (!drag.ghost && moved < 8) return;
  if (!drag.ghost) beginDrag(e, drag);
  drag.ghost.style.left = e.clientX + "px";
  drag.ghost.style.top = e.clientY + "px";
  clearDropOver();
  dropCellAt(e.clientX, e.clientY)?.classList.add("over");
}

function startDragFrom(e) {
  if (drag || e.button !== 0) return;
  if (e.target.closest(".grid-x, .grid-len")) return;
  const chip = e.target.closest("[data-drag-dir]");
  if (chip) {
    const dir = board.directors.find((d) => d.id === chip.dataset.dragDir);
    drag = {
      kind: "chip",
      dirId: chip.dataset.dragDir,
      label: (dir?.unit || dir?.title || "") + " " + (dir?.name || ""),
      color: color(chip.dataset.dragDir),
      chip,
      x: e.clientX,
      y: e.clientY,
      ghost: null,
    };
    return;
  }
  const fill = e.target.closest(".grid-fill[data-drop-cell]");
  if (!fill) return;
  const [day, hour] = fill.dataset.dropCell.split("|");
  const time = fill.dataset.slotTime || hour;
  const dirId = board.assignments[slotKey(board.rules[board.officeIndex].officeId, board.rules[board.officeIndex].pool, day, time)];
  const dir = board.directors.find((d) => d.id === dirId);
  drag = {
    kind: "slot",
    day: Number(day),
    time,
    dirId,
    label: dir?.name || "此時段",
    color: color(dirId || "x"),
    chip: fill,
    x: e.clientX,
    y: e.clientY,
    ghost: null,
  };
}

function finishDrag(e) {
  if (!drag) return;
  const source = drag;
  const didDrag = Boolean(source.ghost);
  const cell = didDrag ? dropCellAt(e.clientX, e.clientY) : null;
  endDrag();
  if (!didDrag) return;
  justDragged = true;
  setTimeout(() => {
    justDragged = false;
  }, 80);
  if (!cell) return;
  const [day, hour] = cell.dataset.dropCell.split("|");
  if (source.kind === "slot") relocateSlot(source.day, source.time, Number(day), hour);
  else assignDirectorToCell(Number(day), hour, source.dirId);
}

document.addEventListener("pointerdown", startDragFrom);
document.addEventListener("mousedown", startDragFrom);
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  if (e.pointerType === "touch") e.preventDefault();
  updateDrag(e);
}, { passive: false });
document.addEventListener("mousemove", (e) => {
  if (drag) updateDrag(e);
});
document.addEventListener("pointerup", finishDrag);
document.addEventListener("mouseup", finishDrag);
document.addEventListener("pointercancel", () => {
  if (drag) endDrag();
});

if ($("#dialog-close")) $("#dialog-close").onclick = () => $("#dialog").close();

try {
  render();
  loadCloud().then(render).catch((err) => toast("讀取雲端失敗：" + rpcError(err)));
} catch (err) {
  toast("畫面載入失敗，請按 Ctrl+F5：" + rpcError(err));
}
