const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let me,
  tab = "sessions",
  rows = [],
  sessions = [],
  candidates = [],
  settings,
  page = 0,
  selectedBooking = null,
  editorCandidate = null,
  weeklyIndex = 0,
  templateKey = "salary_general";
const board = {
  rules: [],
  directors: [],
  assignments: {},
  effectiveDate: "",
  revision: 0,
  staffRevision: 0,
  officeIndex: 0,
  touched: false,
};
const dayNames = ["", "一", "二", "三", "四", "五", "六", "日"];
function slotKey(officeId, pool, day, time) {
  return officeId + "|" + pool + "|" + day + "|" + time;
}
function dirColor(id) {
  const palette = ["#0f7a56", "#1d6fbf", "#b45309", "#7c3aed", "#be185d", "#0f766e"];
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
function syncBoard() {
  const config = settings.schedules,
    staff = settings.staff;
  board.rules = structuredClone(
    config.draft?.rules || config.value.pending?.rules || config.value.current,
  );
  board.directors = structuredClone(staff.value.directors);
  board.assignments = structuredClone(staff.value.assignments);
  board.effectiveDate =
    config.draft?.effectiveDate ||
    config.value.pending?.effectiveDate ||
    me.today;
  board.revision = config.revision;
  board.staffRevision = staff.revision;
  board.touched = false;
}
function groupDirectors(rule) {
  return board.directors.filter(
    (d) => d.officeId === rule.officeId && d.pool === rule.pool,
  );
}
let filter = {
    from: "",
    to: "",
    office: "",
    pool: "",
    job: "",
    status: "",
    applyCity: "",
    search: "",
    sessionId: "",
  },
  busy = false;
const token = () => sessionStorage.getItem("local-review-token") || "";
let candidateOffset = 0,
  candidateNext = null;
let clockLoadedAt = Date.now();
function sessionStatus(s) {
  const now = me.serverTime + (Date.now() - clockLoadedAt) / 1000;
  return s.manual_closed
    ? "人工關閉"
    : !s.rule_active
      ? "排程已移除"
      : s.starts_at <= now
        ? "已開始"
        : s.starts_at <= now + 3600
          ? "已截止"
          : "開放";
}
function notify(message, error = false) {
  $("#status").className = error ? "error" : "success";
  $("#status").textContent = message;
  if (!$("#login").hidden) $("#login-error").textContent = error ? message : "";
}
async function api(path, options = {}) {
  const h = new Headers(options.headers || {});
  h.set("X-Requested-With", "booking-admin");
  if (token()) h.set("Authorization", "Bearer " + token());
  if (options.body) {
    h.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch("/api/admin" + path, {
    ...options,
    headers: h,
    credentials: "same-origin",
  });
  if (!response.ok) {
    let detail;
    try {
      detail = await response.json();
    } catch {
      detail = { message: "請完成公司登入，或確認服務連線。" };
    }
    throw Error(
      (detail.message || detail.error || "操作失敗") +
        (detail.requestId ? "（追查碼 " + detail.requestId + "）" : ""),
    );
  }
  return response;
}
const get = async (path) => (await api(path)).json();
const post = async (path, body, key = null) =>
  (
    await api(path, {
      method: "POST",
      body,
      headers: key ? { "Idempotency-Key": key } : {},
    })
  ).json();
function button(text, action, value = "", kind = "") {
  return `<button data-action="${action}" data-value="${esc(value)}" class="${kind}">${esc(text)}</button>`;
}
function option(value, label, current) {
  return `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`;
}
function select(name, values, current) {
  return `<select name="${name}">${values.map(([v, l]) => option(v, l, current)).join("")}</select>`;
}
const officeLabel = (id) => me.offices.find((o) => o.id === id)?.city || id;
const jobLabel = (id) => me.jobs.find((j) => j.id === id)?.label || id;
const dateTime = (t) =>
  new Date((t + 28800) * 1000).toISOString().slice(0, 16).replace("T", " ");
function table(headers, body) {
  return `<div class="tablewrap"><table><thead><tr>${headers.map((h) => "<th>" + esc(h) + "</th>").join("")}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" class="empty">沒有符合資料</td></tr>`}</tbody></table></div>`;
}
function filters() {
  return `<div class="filters"><label>面試日期起<input data-filter="from" type="date" value="${filter.from}"></label><label>面試日期迄<input data-filter="to" type="date" value="${filter.to}"></label><label>面試地<select data-filter="office">${option("", "全區", filter.office)}${me.offices.map((o) => option(o.id, o.city, filter.office)).join("")}</select></label><label>分組<select data-filter="pool">${[
    ["", "全部"],
    ["general", "一般職缺"],
    ["admin", "行政"],
  ]
    .map(([v, l]) => option(v, l, filter.pool))
    .join("")}</select></label>${
    tab === "bookings"
      ? `<label>應徵職務<select data-filter="job">${option("", "全部", filter.job)}${me.jobs.map((j) => option(j.id, j.label, filter.job)).join("")}</select></label><label>應徵縣市<select data-filter="applyCity">${option("", "全部", filter.applyCity)}${me.cities.map((c) => option(c, c, filter.applyCity)).join("")}</select></label><label>狀態<select data-filter="status">${[
          ["", "全部"],
          ["confirmed", "已預約"],
          ["cancelled", "已取消"],
        ]
          .map(([v, l]) => option(v, l, filter.status))
          .join(
            "",
          )}</select></label><label class="search">姓名／電話／編號<input data-filter="search" value="${esc(filter.search)}"></label>`
      : ""
  }${button("查詢", "search")}${button("清除條件", "reset-filters")}</div>${filter.sessionId ? '<p class="hint">已限制指定場次；清除條件可看全部場次。</p>' : ""}`;
}
function query() {
  return "?" + new URLSearchParams(Object.entries(filter).filter(([, v]) => v));
}
function modal(html) {
  $("#dialog-body").innerHTML = html;
  $("#dialog").showModal();
}
function scope() {
  return `<div class="scope">${esc(me.countScope)}。一般兩職缺共5人、行政獨立5人；系統內人工代約同樣計額。</div>`;
}
async function load() {
  if (tab === "sessions")
    sessions = (
      await get(
        "/sessions?" +
          new URLSearchParams({ from: filter.from, to: filter.to }),
      )
    ).sessions;
  if (tab === "bookings") rows = (await get("/bookings" + query())).bookings;
  if (tab === "candidates") {
    const r = await get("/candidates?offset=" + candidateOffset);
    candidates = r.candidates;
    candidateNext = r.nextOffset;
  }
  if (["schedules", "templates", "retention"].includes(tab)) {
    settings = await get("/settings");
    if (tab === "schedules") syncBoard();
  }
  if (tab === "audit") {
    settings = await get("/audit");
  }
  render();
}
function render() {
  const names = [
    ["sessions", "場次總覽"],
    ["bookings", "預約查詢"],
    ["candidates", "人工接手／代約"],
    ["schedules", "處長與時間"],
    ["templates", "罐頭管理"],
    ["audit", "操作／通知紀錄"],
    ["retention", "保存與清理"],
  ];
  $("#nav").innerHTML = names
    .map(([k, l]) => button(l, "tab", k, tab === k ? "active" : ""))
    .join("");
  let body = "";
  if (tab === "sessions") {
    const list = sessions.filter(
        (s) =>
          (!filter.office || s.office_id === filter.office) &&
          (!filter.pool || s.pool === filter.pool),
      ),
      total = list.reduce((n, s) => n + s.booked, 0);
      body = `${filters()}<div class="stats"><div><small>新系統有效預約</small><strong>${total}</strong></div><div><small>其中行政</small><strong>${list.filter((s) => s.pool === "admin").reduce((n, s) => n + s.booked, 0)}</strong></div><div><small>符合場次／分組</small><strong>${list.length}</strong></div></div><div class="actions">${button("臨時加場", "add-session")}</div>${table(["日期時間", "面試地", "分組", "處長／主管", "已約／容量", "剩餘", "狀態", "管理"], list.map((s) => `<tr><td>${s.local_date} ${s.local_time}</td><td>${officeLabel(s.office_id)}</td><td>${s.pool === "admin" ? "行政" : "一般職缺"}</td><td>${esc(s.interviewer || "尚未指定")}</td><td>${button(s.booked + " / " + s.capacity, "session-bookings", s.id)}</td><td>${Math.max(0, s.capacity - s.booked)}</td><td><span class="badge ${s.manual_closed || !s.rule_active ? "closed" : ""}">${sessionStatus(s)}</span></td><td>${button("容量／停辦", "edit-session", s.id)}</td></tr>`).join(""))}`;
  }
  if (tab === "bookings") {
    const view = rows.slice(page * 20, page * 20 + 20);
    body = `${filters()}<div class="actions">${button("匯出 Excel", "export")}<small>符合 ${rows.length} 筆；匯出所有符合結果，不限目前頁。</small></div>${table(["預約編號", "姓名／電話", "應徵地", "面試地", "職缺", "面試日期時間", "狀態", ""], view.map((b) => `<tr><td>${esc(b.id.slice(0, 8))}</td><td>${esc(b.name)}<small>${esc(b.phone)}</small></td><td>${esc(b.apply_city)}</td><td>${officeLabel(b.office_id)}</td><td>${jobLabel(b.job_id)}</td><td>${b.local_date} ${b.local_time}</td><td>${b.status === "confirmed" ? "已預約" : "已取消"}</td><td>${button("明細", "detail", b.id)}</td></tr>`).join(""))}<div class="pager">${button("上一頁", "page", Math.max(0, page - 1))}<span>${page + 1} / ${Math.max(1, Math.ceil(rows.length / 20))}</span>${button("下一頁", "page", Math.min(Math.max(0, Math.ceil(rows.length / 20) - 1), page + 1))}</div>`;
  }
  if (tab === "candidates")
    body = `<p>先按「人工接手」，再回原 LINE 聊天；處理完按「恢復自動」。</p><p><a href="https://manager.line.biz/" target="_blank" rel="noopener noreferrer">開啟原 LINE 官方帳號後台</a> <small>請同仁自行尋找對話，不承諾直接開啟指定人。瀏覽時不要點未讀訊息。</small></p>${table(["求職者", "狀態", "接手同仁", "更新時間", "操作"], candidates.map((c) => `<tr><td>${esc(c.name || "尚未完成預約")}<small>${esc(c.id.slice(0, 8))}</small></td><td><span class="badge ${c.mode !== "auto" ? "closed" : ""}">${{ auto: "自動", pending_human: "待人工", human: "人工接手" }[c.mode]}</span></td><td>${esc(c.actor || "")}</td><td>${dateTime(c.changed_at)}</td><td>${button("人工接手", "handoff", c.id)} ${button("恢復自動", "resume", c.id)} ${button("協助預約", "assist", c.id)}</td></tr>`).join(""))}`;
  if (tab === "schedules") {
    weeklyIndex = board.officeIndex;
    const r = board.rules[board.officeIndex];
    const people = board.directors
      .map(
        (d) => `<article class="person-card"><div class="person-top"><span class="avatar" style="background:${dirColor(d.id)}">${esc(d.name.slice(0, 1))}</span><div><strong>${esc(d.name)}</strong><span class="meta">${esc(d.unit || d.title)} · ${officeLabel(d.officeId)} · ${d.pool === "admin" ? "行政" : "一般職缺"}</span></div></div><div class="notify">${d.notifyEmail || d.notifyLine ? esc([d.notifyEmail, d.notifyLine].filter(Boolean).join(" · ")) : "還沒填通知方式，之後可再補信箱"}</div><div class="actions">${button("改姓名／通知", "edit-director", d.id)}</div></article>`,
      )
      .join("");
    const pills = board.rules
      .map((row, i) =>
        button(
          officeLabel(row.officeId) + (row.pool === "admin" ? "行政" : "一般"),
          "board-office",
          String(i),
          i === board.officeIndex ? "active" : "",
        ),
      )
      .join("");
    const chips = (day) =>
      (r.isoWeekdays[day] || [])
        .map((time) => {
          const key = slotKey(r.officeId, r.pool, day, time);
          const dir =
            board.directors.find((d) => d.id === board.assignments[key]) ||
            groupDirectors(r)[0];
          return `<button class="slot-chip" data-action="edit-slot" data-value="${esc(day + "|" + time)}" style="background:${dirColor(dir?.id || "x")}"><b>${esc(time)}</b><small>${esc([dir?.unit, dir?.name].filter(Boolean).join(" ") || "尚未指定")}</small></button>`;
        })
        .join("");
    body = `<div class="studio"><div class="studio-hero"><h1>處長與面試時間</h1><p>先改好處長姓名，再把每週固定面試時間排上去。求職者在 LINE 只會看到「套用」之後的時間。</p></div><div class="studio-steps"><span><i class="step-n">1</i>誰來面試：點卡片就能改姓名</span><span><i class="step-n">2</i>每週幾點：點時間可改處長，點＋可加時段</span></div><div class="people-grid">${people}<button class="person-add" data-action="add-director">＋ 新增處長或主管</button></div><div class="week-toolbar"><div class="office-pills">${pills}</div><label>這個組每場最多幾人<input id="board-capacity" type="number" min="1" max="99" value="${r.capacity}"></label></div><p class="hint-card">${officeLabel(r.officeId)}${r.pool === "admin" ? "行政（找主管）" : "一般職缺"}。點色塊可改「這場由誰面試」或刪掉；週末沒排就會是空的。</p><div class="week-board">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<section class="day-col"><h3>星期${dayNames[d]}<small>${(r.isoWeekdays[d] || []).length}場</small></h3>${chips(d)}<button class="ghost-add" data-action="add-slot" data-value="${d}">＋ 加時段</button></section>`).join("")}</div><div class="studio-foot"><label>何時開始用新時間<input id="board-effective" type="date" min="${me.today}" value="${board.effectiveDate}"></label>${button("儲存草稿", "schedule-draft")}${button("預覽並套用給求職者", "schedule-preview", "", "primary")}<small>已有預約不會被搬走。單次停辦請用場次總覽。最後操作：${esc(settings.schedules.actor)}</small></div></div>`;
  }
  if (tab === "templates") {
    const t = settings.templates.value[templateKey],
      d = settings.templateDefinitions.find((t) => t.key === templateKey);
    body = `<div class="grid"><section><label>罐頭種類<select id="template-key">${settings.templateDefinitions.map((t) => option(t.key, templateLabel(t.key), templateKey)).join("")}</select></label><p><span class="badge">v${t.version}</span> 適用：${esc(d.scope)}</p><textarea id="template-text" rows="15">${esc(settings.templates.draft?.[templateKey] ?? t.text)}</textarea><div class="actions">${button("儲存草稿", "template-draft")}${button("預覽發布", "template-preview", "", "primary")}</div></section><section><h2>已發布內容</h2><pre>${esc(t.text)}</pre><small>必要變數：${esc((d.requiredVariables || []).join("、") || "無")}<br>行政薪資及工作內容未核定，交人工。新後台不會自動修改原LINE預設訊息或歡迎訊息。</small></section></div>`;
  }
  if (tab === "audit")
    body = `<h2>回覆待人工確認</h2>${table(["事件編號", "求職者識別", "發送結果", "時間"], settings.delivery.map((d) => `<tr><td>${esc(d.id)}</td><td>${esc(d.candidate_id?.slice(0, 8))}</td><td>${esc(d.delivery_status)}</td><td>${dateTime(d.updated_at)}</td></tr>`).join(""))}<h2>近期操作紀錄</h2>${table(["時間", "操作者", "操作", "對象"], settings.audit.map((a) => `<tr><td>${dateTime(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}</td></tr>`).join(""))}`;
  if (tab === "retention")
    body = `<h2>面試日期後保留一年</h2><p>改期採最後確認日期，取消採原定日期。清除包含該筆預約及其快照、異動和關聯冪等資料，不連帶刪除較新預約。</p><p>到期草稿、按鈕與Webhook短期回覆一併清理；人工接手模式不因草稿到期而恢復。</p><div class="actions">${button("預覽到期資料", "retention-preview")}</div><div class="scope">先確認公司備份與個資刪除流程。清理不會幫您刪除已下載的Excel或外部備份，需由公司另外管理。</div>`;
  if (tab === "candidates")
    body += `<div class="pager">${button("上一頁", "candidate-page", Math.max(0, candidateOffset - 200))}<span>第${Math.floor(candidateOffset / 200) + 1}頁</span>${candidateNext === null ? "" : button("下一頁", "candidate-page", candidateNext)}</div>`;
  const title = names.find(([k]) => k === tab)?.[1];
  $("#view").innerHTML =
    tab === "schedules"
      ? `${scope()}${body}`
      : `<h1>${title}</h1>${scope()}${body}`;
}
function templateLabel(k) {
  return (
    {
      salary_general: "一般薪資與工時",
      work_general: "一般工作內容",
      office_taichung: "台中辦公室",
      office_nantou: "南投辦公室",
      reschedule_offer: "改期詢問",
      nantou_route: "南投面試選擇",
      weather_notice: "停辦說明",
      booking_success: "預約成功",
      choose_slot: "選擇時段",
      full: "名額已滿",
      cutoff: "預約截止",
      human: "轉人工",
      missing_field: "補填資料",
    }[k] || k
  );
}
async function detail(bid) {
  const data = await get("/bookings/" + bid);
  selectedBooking = data.booking;
  const b = data.booking,
    s = b.snapshot;
  modal(
    `<h2>預約明細</h2><dl class="keyvalue"><dt>編號</dt><dd>${esc(b.id)}</dd><dt>姓名電話</dt><dd>${esc(b.name)}／${esc(b.phone)}</dd><dt>職務／應徵地</dt><dd>${jobLabel(b.job_id)}／${esc(b.apply_city)}</dd><dt>面試</dt><dd>${s.date} ${s.time}<br>${esc(s.address)}<br>${esc(s.interviewer || "")}</dd><dt>狀態</dt><dd>${b.status === "confirmed" ? "已預約" : "已取消"}</dd></dl><div class="actions">${b.status === "confirmed" ? button("修改預約", "edit-booking", b.id) + button("取消預約", "cancel-booking", b.id, "danger") : ""}${button("人工接手", "handoff", b.candidate_id)}</div><h2>異動歷程</h2><ul class="history">${data.events.map((e) => `<li><small>${dateTime(e.at)} ${esc(e.actor.startsWith("line:") ? "本人" : e.actor)}</small>${esc({ created: "建立預約", rescheduled: "修改預約", cancelled: "取消預約" }[e.type] || e.type)}<br>${e.before_snapshot ? esc(JSON.parse(e.before_snapshot).date + " " + JSON.parse(e.before_snapshot).time) + " → " : ""}${esc(JSON.parse(e.after_snapshot).date + " " + JSON.parse(e.after_snapshot).time)}</li>`).join("")}</ul>`,
  );
}
let editorKey = null;
async function editor(cid, b = null) {
  editorCandidate = cid;
  selectedBooking = b;
  editorKey = crypto.randomUUID();
  const c = await get("/candidates/" + cid),
    d = b
      ? {
          name: b.name,
          phone: b.phone,
          jobId: b.job_id,
          applyCity: b.apply_city,
          source: b.source,
          officeId: b.office_id,
        }
      : c.conversation.data;
  modal(
    `<h2>${b ? "修改面試預約" : "同仁協助預約"}</h2><form id="booking-form"><div class="grid"><label>姓名<input name="name" value="${esc(d.name || "")}" maxlength="80" required></label><label>電話<input name="phone" type="tel" value="${esc(d.phone || "")}" required></label><label>應徵職務${select(
      "jobId",
      me.jobs.map((j) => [j.id, j.label]),
      d.jobId || "housing_advisor",
    )}</label><label>應徵縣市${select(
      "applyCity",
      me.cities.map((c) => [c, c]),
      d.applyCity || "台中",
    )}</label><label>面試地${select(
      "officeId",
      me.offices.map((o) => [o.id, o.city]),
      d.officeId || "taichung",
    )}</label><label>加入來源${select(
      "source",
      me.sources.map((s) => [s, s]),
      d.source || "未知",
    )}</label></div><div class="actions">${button("載入可預約場次", "load-slots")}</div><label>面試場次<select name="sessionId" required><option value="">請先載入場次</option></select></label><small>系統內代約同樣占5人名額。成功後由同仁回原LINE告知，不自動推播。</small><button class="primary" type="submit">確認儲存預約</button></form>`,
  );
}
function weeklyPayload() {
  const r = board.rules[board.officeIndex];
  r.capacity = Number($("#board-capacity").value);
  return {
    revision: board.revision,
    effectiveDate: $("#board-effective").value,
    rules: board.rules,
  };
}
function directorForm(d = null) {
  const rule = board.rules[board.officeIndex];
  modal(
    `<h2>${d ? "修改處長資料" : "新增處長或主管"}</h2><form id="director-form" data-id="${esc(d?.id || "")}"><label>姓名<input name="name" value="${esc(d?.name || "")}" maxlength="40" required placeholder="例如：黃岳澤"></label><label>處別／單位<input name="unit" value="${esc(d?.unit || "")}" maxlength="20" placeholder="例如：中一處"></label><label>職稱${select("title", [["處長", "處長"], ["主管", "主管"], ["面試官", "面試官"]], d?.title || "處長")}</label><label>面試地${select("officeId", me.offices.map((o) => [o.id, o.city]), d?.officeId || rule.officeId)}</label><label>面試哪一組${select("pool", [["general", "一般職缺"], ["admin", "行政"]], d?.pool || rule.pool)}</label><label>通知信箱（可之後再填）<input name="notifyEmail" type="email" value="${esc(d?.notifyEmail || "")}" placeholder="director@example.com"></label><label>LINE 識別（可空）<input name="notifyLine" value="${esc(d?.notifyLine || "")}" maxlength="80" placeholder="選填"></label><p class="hint">姓名會顯示給求職者。通知信箱之後用來提醒這場由誰面試。</p><button class="primary" type="submit">儲存這位處長</button></form>`,
  );
}
function slotForm(day, time = "") {
  const r = board.rules[board.officeIndex],
    key = time ? slotKey(r.officeId, r.pool, day, time) : "",
    current = board.assignments[key] || groupDirectors(r)[0]?.id || "";
  modal(
    `<h2>${time ? "調整這個時段" : "新增面試時間"}</h2><form id="slot-form" data-day="${day}" data-time="${esc(time)}"><label>星期${dayNames[day]}的時間<input name="time" type="time" value="${esc(time)}" required></label><label>這場由誰面試${select("directorId", groupDirectors(r).map((d) => [d.id, (d.unit ? d.unit + " " : "") + d.name]), current)}</label>${groupDirectors(r).length ? "" : "<p class='scope'>請先在上面新增這間分公司的處長。</p>"}${time ? button("刪掉這個時段", "remove-slot", day + "|" + time, "danger") : ""}<button class="primary" type="submit">${time ? "更新時段" : "加入時間表"}</button></form>`,
  );
}
async function action(a, v) {
  if (a === "candidate-page") {
    candidateOffset = Number(v);
    await load();
  }
  if (a === "tab") {
    tab = v;
    page = 0;
    filter.sessionId = "";
    await load();
  }
  if (a === "board-office") {
    const r = board.rules[board.officeIndex];
    if ($("#board-capacity")) r.capacity = Number($("#board-capacity").value);
    if ($("#board-effective")) board.effectiveDate = $("#board-effective").value;
    board.officeIndex = Number(v);
    weeklyIndex = board.officeIndex;
    render();
  }
  if (a === "add-director") directorForm();
  if (a === "edit-director")
    directorForm(board.directors.find((d) => d.id === v));
  if (a === "add-slot") slotForm(Number(v));
  if (a === "edit-slot") {
    const [day, time] = v.split("|");
    slotForm(Number(day), time);
  }
  if (a === "remove-slot") {
    const r = board.rules[board.officeIndex],
      [day, time] = v.split("|");
    r.isoWeekdays[day] = (r.isoWeekdays[day] || []).filter((t) => t !== time);
    delete board.assignments[slotKey(r.officeId, r.pool, day, time)];
    board.touched = true;
    $("#dialog").close();
    render();
  }
  if (a === "search") {
    document
      .querySelectorAll("[data-filter]")
      .forEach((el) => (filter[el.dataset.filter] = el.value));
    page = 0;
    await load();
  }
  if (a === "reset-filters") {
    filter = {
      from: me.today,
      to: new Date(Date.parse(me.today + "T00:00:00Z") + 13 * 86400000)
        .toISOString()
        .slice(0, 10),
      office: "",
      pool: "",
      job: "",
      status: "",
      applyCity: "",
      search: "",
      sessionId: "",
    };
    page = 0;
    await load();
  }
  if (a === "session-bookings") {
    const s = sessions.find((s) => s.id === v);
    filter = {
      ...filter,
      from: s.local_date,
      to: s.local_date,
      office: s.office_id,
      pool: s.pool,
      job: "",
      status: "confirmed",
      applyCity: "",
      search: "",
      sessionId: s.id,
    };
    tab = "bookings";
    page = 0;
    await load();
  }
  if (a === "page") {
    page = Number(v);
    render();
  }
  if (a === "detail") await detail(v);
  if (a === "handoff" || a === "resume") {
    await post("/candidates/" + v + "/" + a, {});
    notify(
      a === "handoff"
        ? "已保存人工接手狀態。請回原LINE處理，完成後再恢復自動。"
        : "已恢復自動。",
    );
    await load();
  }
  if (a === "assist") {
    const c = await get("/candidates/" + v);
    await editor(
      v,
      c.active
        ? { ...c.active, snapshot: JSON.parse(c.active.snapshot) }
        : null,
    );
  }
  if (a === "edit-booking") {
    const b = (await get("/bookings/" + v)).booking;
    await editor(b.candidate_id, b);
  }
  if (a === "load-slots") {
    const f = new FormData($("#booking-form")),
      query = new URLSearchParams({
        officeId: f.get("officeId"),
        jobId: f.get("jobId"),
      });
    if (selectedBooking) query.set("excludeBookingId", selectedBooking.id);
    const list = (await get("/available?" + query)).sessions.filter(
      (s) => s.remaining > 0,
    );
    $("#booking-form [name=sessionId]").innerHTML =
      option("", "請選擇", "") +
      list
        .map((s) =>
          option(
            s.id,
            s.local_date + " " + s.local_time + "（剩" + s.remaining + "）",
            "",
          ),
        )
        .join("");
  }
  if (a === "cancel-booking") {
    const b = selectedBooking;
    modal(
      `<h2>確認取消預約</h2><p>${esc(b.name)}，${b.local_date} ${b.local_time}</p><p>取消後釋放名額，原LINE通知由同仁處理。</p>${button("確認取消", "cancel-commit", b.id, "danger")}`,
    );
  }
  if (a === "cancel-commit") {
    await post(
      "/bookings/" + v + "/cancel",
      { revision: selectedBooking.revision, confirm: true },
      crypto.randomUUID(),
    );
    $("#dialog").close();
    notify("預約已取消，請回原LINE告知。");
    await load();
  }
  if (a === "export") {
    const response = await api("/export.xlsx" + query()),
      blob = await response.blob(),
      href = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = href;
    link.download = "interview-bookings.xlsx";
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    notify("已匯出目前篩選結果。檔案含個資，請妥善保管。");
  }
  if (a === "edit-session") {
    const s = sessions.find((s) => s.id === v);
    modal(
      `<h2>場次容量與停辦</h2><p>${officeLabel(s.office_id)} ${s.local_date} ${s.local_time}／${s.pool === "admin" ? "行政" : "一般職缺"}，已約${s.booked}人</p><form id="session-form" data-id="${esc(s.id)}" data-revision="${s.revision}"><label>容量<input name="capacity" type="number" min="1" max="99" value="${s.capacity}" required></label><label>場次狀態<select name="closed">${option("false", "開放", String(!!s.manual_closed))}${option("true", "人工關閉", String(!!s.manual_closed))}</select></label><label>原因<textarea name="reason" maxlength="300" required>${esc(s.reason)}</textarea></label><small>降低容量不刪已約者；關閉場次後請按受影響名單回原LINE通知。</small><button class="primary">確認修改</button></form>`,
    );
  }
  if (a === "add-session")
    modal(
      `<h2>臨時加場</h2><form id="extra-form"><label>面試地${select(
        "officeId",
        me.offices.map((o) => [o.id, o.city]),
        "taichung",
      )}</label><label>分組${select(
        "pool",
        [
          ["general", "一般職缺"],
          ["admin", "行政"],
        ],
        "general",
      )}</label><label>日期<input name="date" type="date" min="${me.today}" required></label><label>時間<input name="time" type="time" required></label><label>容量<input name="capacity" type="number" value="5" min="1" max="99" required></label><label>原因<input name="reason" maxlength="300" required></label><button class="primary">確認加場</button></form>`,
    );
  if (a === "schedule-draft") {
    if ($("#board-capacity"))
      board.rules[board.officeIndex].capacity = Number(
        $("#board-capacity").value,
      );
    if ($("#board-effective")) board.effectiveDate = $("#board-effective").value;
    const staffSaved = await post("/staff", {
      directors: board.directors,
      assignments: board.assignments,
      rules: board.rules,
      revision: board.staffRevision,
    });
    board.staffRevision = staffSaved.revision;
    await post("/schedules/draft", weeklyPayload());
    notify("排程草稿已儲存，尚未發布。處長姓名已立即更新。");
    await load();
  }
  if (a === "schedule-preview") {
    if ($("#board-capacity"))
      board.rules[board.officeIndex].capacity = Number(
        $("#board-capacity").value,
      );
    if ($("#board-effective")) board.effectiveDate = $("#board-effective").value;
    const staffSaved = await post("/staff", {
      directors: board.directors,
      assignments: board.assignments,
      rules: board.rules,
      revision: board.staffRevision,
    });
    board.staffRevision = staffSaved.revision;
    const p = weeklyPayload(),
      result = await post("/schedules/preview", p);
    window.pendingSchedule = p;
    modal(
      `<h2>套用給求職者之前</h2><p>生效日：${p.effectiveDate}。已有預約保持原時間。處長姓名已先存好。</p>${table(["場次", "已約", "調整"], result.affected.map((s) => `<tr><td>${officeLabel(s.office_id)} ${s.local_date} ${s.local_time}</td><td>${s.booked}</td><td>${s.removed ? "停止新約" : "容量 " + s.capacity + " → " + s.newCapacity}</td></tr>`).join(""))}<div class="actions">${button("確認套用", "schedule-publish", "", "primary")}</div>`,
    );
  }
  if (a === "schedule-publish") {
    await post("/schedules/publish", {
      ...window.pendingSchedule,
      confirm: true,
    });
    $("#dialog").close();
    notify("新時間已套用，求職者會看到更新後的場次。");
    await load();
  }
  if (a === "template-draft") {
    await post("/templates/" + templateKey + "/draft", {
      text: $("#template-text").value,
      revision: settings.templates.revision,
    });
    notify("罐頭草稿已儲存。");
    await load();
  }
  if (a === "template-preview") {
    window.pendingTemplate = $("#template-text").value;
    modal(
      `<h2>罐頭發布預覽</h2><pre>${esc(window.pendingTemplate)}</pre><p>只影響之後回覆，不修改原LINE歡迎訊息。</p>${button("確認發布", "template-publish", "", "primary")}`,
    );
  }
  if (a === "template-publish") {
    await post("/templates/" + templateKey + "/publish", {
      text: window.pendingTemplate,
      revision: settings.templates.revision,
      confirm: true,
    });
    $("#dialog").close();
    notify("罐頭已發布。");
    await load();
  }
  if (a === "retention-preview") {
    const r = await get("/retention");
    window.pendingRetention = r;
    modal(
      `<h2>到期資料預覽</h2><p>截至${r.date}，${r.count}筆已到期預約。</p><p>刪除無法透過畫面復原。先確認公司備份與刪除規範，較新預約不受影響。</p><pre>${esc(r.bookings.map((b) => b.id + "／" + b.retention_due).join("\n") || "無到期預約")}</pre>${button("確認清除到期資料", "retention-purge", "", "danger")}`,
    );
  }
  if (a === "retention-purge") {
    const r = await post("/retention/purge", {
      date: window.pendingRetention.date,
      confirm: true,
    });
    $("#dialog").close();
    notify(
      `本批清理${r.count}筆到期預約。${r.hasMore ? "還有到期資料，請重新預覽下一批。" : ""}`,
    );
  }
}
async function guarded(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    notify(e.message, true);
    if ($("#dialog").open) {
      let error = $("#dialog-error");
      if (!error) {
        error = document.createElement("p");
        error.id = "dialog-error";
        error.className = "scope";
        $("#dialog-body").prepend(error);
      }
      error.textContent = e.message;
    }
  } finally {
    busy = false;
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (b) {
    e.preventDefault();
    guarded(() => action(b.dataset.action, b.dataset.value));
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "template-key") {
    templateKey = e.target.value;
    render();
  }
  if (e.target.id === "board-capacity") {
    board.rules[board.officeIndex].capacity = Number(e.target.value);
    board.touched = true;
  }
  if (e.target.id === "board-effective") {
    board.effectiveDate = e.target.value;
    board.touched = true;
  }
  if (
    e.target.closest("#booking-form") &&
    ["officeId", "jobId", "applyCity"].includes(e.target.name)
  ) {
    $("#booking-form [name=sessionId]").innerHTML =
      '<option value="">請重新載入場次</option>';
  }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  guarded(async () => {
    const f = e.target,
      data = Object.fromEntries(new FormData(f));
    if (f.id === "director-form") {
      if (data.pool === "admin" && data.officeId !== "taichung")
        throw Error("行政面試固定在台中，請改面試地或改回一般職缺。");
      const next = {
        id: f.dataset.id || crypto.randomUUID(),
        name: data.name,
        title: data.title,
        unit: data.unit || "",
        officeId: data.officeId,
        pool: data.pool,
        notifyEmail: data.notifyEmail || "",
        notifyLine: data.notifyLine || "",
      };
      const i = board.directors.findIndex((d) => d.id === next.id);
      if (i >= 0) board.directors[i] = next;
      else board.directors.push(next);
      board.touched = true;
      $("#dialog").close();
      render();
      return;
    }
    if (f.id === "slot-form") {
      const r = board.rules[board.officeIndex],
        day = f.dataset.day,
        oldTime = f.dataset.time,
        time = String(data.time || "").slice(0, 5);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
        throw Error("請用 24 小時制時間，例如 14:00。");
      r.isoWeekdays[day] = r.isoWeekdays[day] || [];
      if (oldTime && oldTime !== time) {
        r.isoWeekdays[day] = r.isoWeekdays[day].filter((t) => t !== oldTime);
        delete board.assignments[slotKey(r.officeId, r.pool, day, oldTime)];
      }
      if (!r.isoWeekdays[day].includes(time)) {
        r.isoWeekdays[day] = [...r.isoWeekdays[day], time].sort();
      }
      board.assignments[slotKey(r.officeId, r.pool, day, time)] =
        data.directorId;
      board.touched = true;
      $("#dialog").close();
      render();
      return;
    }
    if (f.id === "booking-form") {
      const payload = {
        candidateId: editorCandidate,
        sessionId: data.sessionId,
        profile: {
          name: data.name,
          phone: data.phone,
          jobId: data.jobId,
          applyCity: data.applyCity,
          source: data.source,
        },
        confirm: true,
      };
      if (selectedBooking) payload.revision = selectedBooking.revision;
      await post(
        selectedBooking
          ? "/bookings/" + selectedBooking.id + "/reschedule"
          : "/bookings",
        payload,
        editorKey,
      );
      $("#dialog").close();
      notify("預約已儲存成功，請回原LINE告知求職者。");
      await load();
    }
    if (f.id === "session-form") {
      const r = await post("/sessions/" + f.dataset.id, {
        revision: Number(f.dataset.revision),
        capacity: Number(data.capacity),
        closed: data.closed === "true",
        reason: data.reason,
      });
      modal(
        `<h2>場次已更新</h2><p>以下${r.affected.length}位既有預約仍保留，請同仁確認並在原LINE通知。</p>${table(["姓名", "電話"], r.affected.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.phone)}</td></tr>`).join(""))}`,
      );
      await load();
    }
    if (f.id === "extra-form") {
      await post("/sessions", { ...data, capacity: Number(data.capacity) });
      $("#dialog").close();
      notify("臨時場次已建立。");
      await load();
    }
  });
});
$("#dialog-close").addEventListener("click", () => $("#dialog").close());
$("#reload").addEventListener("click", () => guarded(load));
$("#logout").addEventListener("click", () => {
  sessionStorage.removeItem("local-review-token");
  location.href = ["127.0.0.1", "localhost"].includes(location.hostname)
    ? "/"
    : "/cdn-cgi/access/logout";
});
async function boot() {
  try {
    me = await get("/me");
    clockLoadedAt = Date.now();
    $("#login").hidden = true;
    notify("");
    $("#workspace").hidden = false;
    $("#identity").textContent = me.identity.email + " · 全區同權限";
    $("#environment").textContent =
      me.environment + (me.launchApproved ? "" : " · LINE尚未開放");
    filter.from = me.today;
    filter.to = new Date(Date.parse(me.today + "T00:00:00Z") + 13 * 86400000)
      .toISOString()
      .slice(0, 10);
    await load();
  } catch (e) {
    $("#login").hidden = false;
    $("#workspace").hidden = true;
    $("#identity").textContent = "尚未登入";
    $("#login-form").hidden = !["127.0.0.1", "localhost"].includes(
      location.hostname,
    );
    notify(e.message, true);
  }
}
await boot();
