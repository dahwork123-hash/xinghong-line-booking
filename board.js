import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const DAY = ["", "一", "二", "三", "四", "五", "六", "日"];
const OFFICES = { taichung: "台中", changhua: "彰化", chiayi: "嘉義", hsinchu: "新竹" };
const JOBS = ["社宅顧問", "儲備主管", "行政職"];
const CITIES = ["新竹", "台中", "彰化", "嘉義", "南投"];
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
  rules: [
    { officeId: "taichung", pool: "general", capacity: 5, isoWeekdays: { 1: ["11:00-13:00", "14:00-16:00"], 2: ["11:00-13:00", "14:00-16:00", "16:00-18:00"], 3: ["10:00-12:00", "14:00-16:00", "16:00-18:00"], 4: ["11:00-13:00", "14:00-16:00", "16:00-18:00"], 5: ["14:00-16:00", "16:00-18:00"] } },
  ],
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
  };
};

let board = defaults();
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (saved?.directors && saved?.rules) board = { ...defaults(), ...saved };
} catch {}

let candidates = [];
let bookings = [];
let weekOffset = 0;

const persist = () => {
  localStorage.setItem(KEY, JSON.stringify(board));
  toast("時間表已存在這台電腦。面試者資料在雲端，同仁都看得到。");
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
  } catch (e) {
    toast("讀取面試者失敗：" + rpcError(e));
  }
}

function render() {
  const r = board.rules[board.officeIndex];
  const people = board.directors
    .map(
      (d) => `<article class="person-card"><div class="person-top"><span class="avatar" style="background:${color(d.id)}">${esc(d.name.slice(0, 1))}</span><div><strong>${esc(d.name)}</strong><span class="meta">${esc(d.unit || d.title)} · ${esc(OFFICES[d.officeId])} · ${d.pool === "admin" ? "行政" : "一般職缺"}</span></div></div><div class="notify">${d.notifyEmail || d.notifyLine ? esc([d.notifyEmail, d.notifyLine].filter(Boolean).join(" · ")) : "還沒填通知方式"}</div><div class="actions"><button data-act="edit-dir" data-id="${esc(d.id)}">改姓名／通知</button></div></article>`,
    )
    .join("");
  const chips = (day) => {
    const date = dateForDay(weekOffset, day);
    return (r.isoWeekdays[day] || [])
      .map((time) => {
        const start = parseRange(time).start;
        const dir =
          board.directors.find((d) => d.id === board.assignments[slotKey(r.officeId, r.pool, day, time)]) ||
          group(r)[0];
        const seated = slotBookings(date, start);
        const names = seated.map((b) => candidates.find((c) => c.id === b.candidate_id)?.name || "面試者").join("、");
        return `<button class="slot-chip" data-act="open-slot" data-id="${day}|${time}" style="background:${color(dir?.id || "x")}"><b>${esc(rangeLabel(time))}</b><small>${esc([dir?.unit, dir?.name].filter(Boolean).join(" ") || "尚未指定")}</small><span class="count">${seated.length}/${r.capacity}${names ? " · " + esc(names) : ""}</span></button>`;
      })
      .join("");
  };
  const rows = candidates
    .map((c) => {
      const b = activeBooking(c.id);
      const when = b ? `${b.interview_date} ${b.start_time}–${b.end_time}` : "尚未安排";
      return `<tr><td><strong>${esc(c.name)}</strong><small>${esc(c.phone || "未填電話")}</small></td><td>${esc(c.job)}<small>${esc(c.apply_city)} · ${esc(c.source)}</small></td><td>${esc(when)}<small>${esc(b?.director_label || "")}</small></td><td>${b ? `<button data-act="cancel-booking" data-id="${esc(b.id)}">取消此時段</button>` : `<button class="primary" data-act="pick-slot" data-id="${esc(c.id)}">安排時段</button>`}<button data-act="edit-candidate" data-id="${esc(c.id)}">改資料</button></td></tr>`;
    })
    .join("");
  const weekLabel = dateForDay(weekOffset, 1) + " ～ " + dateForDay(weekOffset, 7);
  $("#app").innerHTML = `<div class="studio"><div class="studio-hero"><h1>面試者與面試時間</h1><p>上面排本週時段，下面是面試者名單。點色塊可把人排進去，資料存在雲端。</p></div><div class="week-toolbar"><div class="week-switch"><button data-act="week" data-id="${weekOffset - 1}">上一週</button><strong>${esc(weekLabel)}</strong><button data-act="week" data-id="${weekOffset + 1}">下一週</button></div><label>這個組每場最多幾人<input id="cap" type="number" min="1" max="99" value="${r.capacity}"></label></div><p class="hint-card">台中一般職缺。點時段可指定處長，也可把面試者排進那一場。</p><div class="week-board">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<section class="day-col"><h3>星期${DAY[d]}<small>${dateForDay(weekOffset, d).slice(5)}</small></h3>${chips(d)}<button class="ghost-add" data-act="add-slot" data-id="${d}">＋ 加時段</button></section>`).join("")}</div><div class="candidate-panel"><div class="candidate-toolbar"><h2>面試者</h2><button class="primary" data-act="add-candidate">＋ 新增面試者</button><small>${candidates.length} 人 · 已安排 ${bookings.filter((b) => b.interview_date >= taipeiToday()).length} 場</small></div>${candidates.length ? `<table class="candidate-table"><thead><tr><th>姓名／電話</th><th>職缺</th><th>面試時間</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p>還沒有面試者。按「新增面試者」把 104／LINE 收到的資料填進來。</p>`}</div><div class="people-grid">${people}<button class="person-add" data-act="add-dir">＋ 新增處長或主管</button></div><div class="studio-foot"><button class="primary" data-act="save">儲存時間表到這台電腦</button><button data-act="reset">回復預設時段</button><small>面試者資料在雲端，打開這頁就能看、就能排時段。</small></div></div>`;
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
    `<h2>${c ? "修改面試者" : "新增面試者"}</h2><form id="candidate-form" data-id="${esc(c?.id || "")}"><label>姓名<input name="name" value="${esc(c?.name || "")}" maxlength="80" required></label><label>電話<input name="phone" value="${esc(c?.phone || "")}" maxlength="20" placeholder="09xxxxxxxx"></label><label>應徵職務<select name="job">${JOBS.map((j) => `<option ${j === (c?.job || "社宅顧問") ? "selected" : ""}>${j}</option>`).join("")}</select></label><label>應徵縣市<select name="apply_city">${CITIES.map((j) => `<option ${j === (c?.apply_city || "台中") ? "selected" : ""}>${j}</option>`).join("")}</select></label><label>來源<select name="source">${SOURCES.map((j) => `<option ${j === (c?.source || "未知") ? "selected" : ""}>${j}</option>`).join("")}</select></label><label>備註<textarea name="notes" maxlength="500">${esc(c?.notes || "")}</textarea></label><button class="primary">存到雲端</button></form>`,
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
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = b.dataset.act,
    v = b.dataset.id;
  if (a === "week") {
    weekOffset = Number(v);
    render();
    return;
  }
  if (a === "add-dir") return dirForm();
  if (a === "edit-dir") return dirForm(board.directors.find((d) => d.id === v));
  if (a === "add-slot") return slotForm(Number(v));
  if (a === "edit-slot") {
    const [day, time] = v.split("|");
    return slotForm(Number(day), time);
  }
  if (a === "open-slot") {
    const [day, time] = v.split("|");
    return openSlot(Number(day), time);
  }
  if (a === "add-candidate") return candidateForm();
  if (a === "edit-candidate") return candidateForm(candidates.find((c) => c.id === v));
  if (a === "pick-slot") return pickSlot(v);
  if (a === "remove-slot") {
    const r = board.rules[board.officeIndex],
      [day, time] = v.split("|");
    r.isoWeekdays[day] = (r.isoWeekdays[day] || []).filter((t) => t !== time);
    delete board.assignments[slotKey(r.officeId, r.pool, day, time)];
    $("#dialog").close();
    persist();
    render();
    return;
  }
  if (a === "save") persist();
  if (a === "reset") {
    board = defaults();
    localStorage.removeItem(KEY);
    toast("已回復預設時間表。");
    render();
  }
  if (a === "cancel-booking") {
    guarded(async () => {
      await rpc("xinghong_cancel", { p_booking_id: v });
      await loadCloud();
      $("#dialog").close();
      toast("已取消此時段，名額釋出。");
      render();
    });
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "cap") board.rules[board.officeIndex].capacity = Number(e.target.value);
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
});

$("#dialog-close").onclick = () => $("#dialog").close();

render();
loadCloud().then(render);
