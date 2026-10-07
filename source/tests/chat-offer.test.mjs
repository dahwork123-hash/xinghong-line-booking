import test from "node:test";
import assert from "node:assert/strict";
import {
  composeOffer,
  composeConfirm,
  composeReminder,
  composeDirectorNotice,
  composeAskJob,
  parseTimeReply,
  buildLineReply,
  classifyLineText,
  classifyBindText,
  DEFAULT_TAICHUNG_WEEK,
  TAICHUNG_OFFICE,
} from "../src/chat-offer.js";

test("offer text matches the current staff weekly times", () => {
  const text = composeOffer(DEFAULT_TAICHUNG_WEEK, TAICHUNG_OFFICE);
  assert.match(text, /禮拜一，上午11點、下午2點/);
  assert.match(text, /禮拜二，上午11點、下午2點或4點/);
  assert.match(text, /禮拜三，上午10點、下午2點或4點/);
  assert.match(text, /禮拜四，上午11點、下午2點或4點/);
  assert.match(text, /禮拜五，下午2點或4點/);
  assert.match(text, /請問您哪個時段可以來面試呢\?/);
  assert.doesNotMatch(text, /文心路/);
});

test("confirm reply includes address and arrival notes", () => {
  const text = composeConfirm();
  assert.match(text, /^好的，提供您面試地點:/);
  assert.match(text, /文心路四段698號6樓之1/);
  assert.match(text, /請自備原子筆/);
  assert.match(text, /團體面試/);
});

test("parses natural-language time replies onto the matching slot", () => {
  const picked = parseTimeReply("您好，禮拜一下午2點可以，謝謝", {
    today: "2026-09-11",
    nowHm: "22:00",
    isoWeekdays: DEFAULT_TAICHUNG_WEEK,
  });
  assert.equal(picked.ok, true);
  assert.equal(picked.date, "2026-09-14");
  assert.equal(picked.start, "14:00");
  assert.equal(picked.end, "16:00");
});

test("uses this week's weekday when that slot is still upcoming", () => {
  const picked = parseTimeReply("禮拜三上午10點", {
    today: "2026-09-07",
    nowHm: "09:00",
    isoWeekdays: DEFAULT_TAICHUNG_WEEK,
  });
  assert.equal(picked.ok, true);
  assert.equal(picked.date, "2026-09-09");
  assert.equal(picked.start, "10:00");
});

test("reminder uses tomorrow's short date and start time", () => {
  const text = composeReminder("2026-09-12", "14:00");
  assert.match(text, /明天（9\/12）下午2點面試/);
  assert.match(text, /文心路四段698號6樓之1/);
});

test("skips today's slot after the one-hour cutoff", () => {
  const picked = parseTimeReply("禮拜一下午2點", {
    today: "2026-09-14",
    nowHm: "13:00",
    isoWeekdays: DEFAULT_TAICHUNG_WEEK,
  });
  assert.equal(picked.ok, true);
  assert.equal(picked.date, "2026-09-21");
});

test("keeps today's slot before the one-hour cutoff", () => {
  const picked = parseTimeReply("禮拜一下午2點", {
    today: "2026-09-14",
    nowHm: "12:30",
    isoWeekdays: DEFAULT_TAICHUNG_WEEK,
  });
  assert.equal(picked.date, "2026-09-14");
});

test("combines rich-menu commands with natural-language booking", () => {
  assert.equal(classifyLineText("常見問題").kind, "faq");
  assert.equal(classifyLineText("聯絡同仁").kind, "human");
  const faq = buildLineReply({ text: "工作內容", today: "2026-09-13" });
  assert.match(faq.text, /社會住宅/);
  const paused = buildLineReply({ text: "預約面試", today: "2026-09-13", humanMode: true });
  assert.equal(paused.silent, true);
  const ask = buildLineReply({ text: "預約面試", today: "2026-09-13" });
  assert.match(ask.text, /哪個縣市/);
  assert.equal(ask.actions.length, 0);
  const custom = buildLineReply({
    text: "台中",
    today: "2026-09-13",
    customOffer: "自訂約訪文案",
    profile: { profileOk: true },
  });
  assert.match(custom.text, /自訂約訪文案/);
  assert.equal(custom.actions[0].type, "touch");
  assert.equal(custom.actions[0].city, "台中");
});

test("asks for city before booking a timeslot", () => {
  const missing = buildLineReply({
    text: "您好，禮拜一下午2點可以，謝謝",
    today: "2026-09-11",
    nowHm: "22:00",
  });
  assert.match(missing.text, /哪個縣市/);
  assert.equal(missing.actions.length, 0);

  const book = buildLineReply({
    text: "您好，禮拜一下午2點可以，謝謝",
    today: "2026-09-11",
    nowHm: "22:00",
    applyCity: "台中",
    profile: { profileOk: true },
  });
  assert.equal(book.actions[0].type, "book");
  assert.equal(book.actions[0].picked.start, "14:00");
  assert.equal(book.actions[0].picked.officeId, "taichung");
});

test("shows that city's slots after the applicant picks a city", () => {
  const chiayi = buildLineReply({
    text: "嘉義",
    today: "2026-09-13",
    schedule: {
      rules: [{ officeId: "chiayi", pool: "general", capacity: 5, isoWeekdays: { 3: ["16:00-18:00"], 4: ["16:00-18:00"] } }],
    },
    profile: { profileOk: true },
  });
  assert.match(chiayi.text, /禮拜三，下午4點/);
  assert.doesNotMatch(chiayi.text, /上海路/);
  assert.doesNotMatch(chiayi.text, /禮拜一/);

  const hsinchu = buildLineReply({
    text: "禮拜四下午2點",
    today: "2026-09-14",
    nowHm: "10:00",
    applyCity: "新竹",
    profile: { profileOk: true },
  });
  assert.equal(hsinchu.actions[0].type, "book");
  assert.equal(hsinchu.actions[0].picked.date, "2026-09-17");
  assert.equal(hsinchu.actions[0].picked.officeId, "hsinchu");
  assert.match(hsinchu.text, /光明五街342號2樓/);

  const nantou = buildLineReply({ text: "南投", today: "2026-09-13", profile: { profileOk: true } });
  assert.match(nantou.text, /台中或彰化面試/);
  assert.equal(nantou.actions[0].interviewCity, "");

  const nantouToChanghua = buildLineReply({
    text: "2",
    today: "2026-09-13",
    applyCity: "南投",
    profile: { profileOk: true },
  });
  assert.equal(nantouToChanghua.actions[0].interviewCity, "彰化");
  assert.match(nantouToChanghua.text, /禮拜四/);

  const nantouSwitch = buildLineReply({
    text: "新竹",
    today: "2026-09-13",
    applyCity: "南投",
    profile: { profileOk: true },
  });
  assert.equal(nantouSwitch.actions[0].city, "新竹");
  assert.equal(nantou.actions[0].city, "南投");

  const nantouToTaichung = buildLineReply({
    text: "1",
    today: "2026-09-13",
    applyCity: "南投",
    profile: { profileOk: true },
    customOffer: "台中約訪文案",
  });
  assert.match(nantouToTaichung.text, /台中約訪文案/);
  assert.equal(nantouToTaichung.actions[0].interviewCity, "台中");

  const taoyuan = buildLineReply({ text: "桃園", today: "2026-09-13", profile: { profileOk: true } });
  assert.match(taoyuan.text, /尚未排可預約時段/);
  assert.equal(taoyuan.actions[0].city, "桃園");
});

test("uses a staff-edited interview address when confirming a booking", () => {
  const reply = buildLineReply({
    text: "禮拜一下午2點",
    today: "2026-09-14",
    nowHm: "10:00",
    applyCity: "台中",
    profile: { profileOk: true },
    schedule: {
      officeDetails: { taichung: { address: "自訂面試地點123號" } },
    },
  });
  assert.match(reply.text, /自訂面試地點123號/);
});

test("sends that city's address only after the applicant books a slot", () => {
  const schedule = {
    rules: [{ officeId: "taoyuan", pool: "general", capacity: 5, isoWeekdays: { 1: ["14:00-16:00"], 3: ["14:00-16:00"] } }],
    lineOffers: {
      taoyuan: "您好，以下為可預約時段\n\n禮拜一，下午2點\n禮拜三，下午2點\n\n請直接回覆可以面試時段",
    },
    officeDetails: { taoyuan: { address: "桃園市中壢區環北路400號13樓之六" } },
  };
  const offer = buildLineReply({ text: "桃園", today: "2026-09-14", schedule, profile: { profileOk: true } });
  assert.match(offer.text, /禮拜一，下午2點/);
  assert.doesNotMatch(offer.text, /環北路/);
  assert.doesNotMatch(offer.text, /文心路/);

  const book = buildLineReply({
    text: "禮拜三下午兩點",
    today: "2026-09-14",
    nowHm: "10:00",
    applyCity: "桃園",
    profile: { profileOk: true },
    schedule,
  });
  const booked = book.actions.find((a) => a.type === "book");
  assert.equal(booked.picked.officeId, "taoyuan");
  assert.equal(booked.picked.city, "桃園");
  assert.match(book.text, /環北路400號13樓之六/);
  assert.doesNotMatch(book.text, /文心路/);
});

test("asks for name, phone and job before showing slots or confirming", () => {
  const city = buildLineReply({ text: "台中", today: "2026-09-14" });
  assert.match(city.text, /真實姓名/);
  assert.doesNotMatch(city.text, /哪個時段/);

  const name = buildLineReply({
    text: "王小明",
    today: "2026-09-14",
    applyCity: "台中",
    profile: { namePicked: false },
  });
  assert.equal(name.actions[0].name, "王小明");
  assert.match(name.text, /手機號碼/);

  const phone = buildLineReply({
    text: "0912-345-678",
    today: "2026-09-14",
    applyCity: "台中",
    profile: { namePicked: true, name: "王小明" },
  });
  assert.equal(phone.actions[0].phone, "0912345678");
  assert.match(phone.text, /應徵哪個職位/);

  const job = buildLineReply({
    text: "2",
    today: "2026-09-14",
    applyCity: "台中",
    profile: { namePicked: true, name: "王小明", phone: "0912345678" },
  });
  assert.equal(job.actions[0].job, "儲備主管");
  assert.match(job.text, /請問您哪個時段可以來面試呢/);
  assert.equal(classifyLineText("社宅顧問").value, "社宅顧問");
  assert.match(composeAskJob(), /1 社宅顧問，或 2 儲備主管/);

  const tooSoon = buildLineReply({
    text: "禮拜一下午2點",
    today: "2026-09-14",
    nowHm: "10:00",
    applyCity: "台中",
  });
  assert.equal(tooSoon.actions[0].type, "pending");
  assert.match(tooSoon.text, /真實姓名/);
});

test("我的預約 shows the live slot and ignores leftover past bookings", () => {
  assert.equal(classifyLineText("我的面試").kind, "mine");
  assert.equal(classifyLineText("我的預約\u200b").kind, "mine");
  const past = { interview_date: "2026-09-21", start_time: "14:00" };
  const empty = buildLineReply({
    text: "我的預約",
    today: "2026-09-22",
    nowHm: "21:59",
    booking: past,
    applyCity: "桃園",
  });
  assert.match(empty.text, /沒有尚未開始的有效預約/);
  assert.doesNotMatch(empty.text, /哪個縣市/);

  const live = buildLineReply({
    text: "我的預約",
    today: "2026-09-22",
    nowHm: "21:59",
    booking: { interview_date: "2026-09-28", start_time: "14:00" },
    applyCity: "桃園",
  });
  assert.match(live.text, /您目前已預約 9\/28（禮拜一）下午2點/);
});

test("expired bookings do not block a new 預約面試", () => {
  const past = {
    interview_date: "2026-09-21",
    start_time: "14:00",
  };
  const retry = buildLineReply({
    text: "預約面試",
    today: "2026-09-22",
    nowHm: "21:45",
    booking: past,
    applyCity: "桃園",
    profile: { profileOk: true },
  });
  assert.match(retry.text, /哪個縣市/);
  assert.doesNotMatch(retry.text, /您目前已預約/);

  const stillOn = buildLineReply({
    text: "預約面試",
    today: "2026-09-21",
    nowHm: "13:00",
    booking: past,
  });
  assert.match(stillOn.text, /您目前已預約/);
});

test("asks which Taichung office when staff added a second address", () => {
  const schedule = {
    officeDetails: {
      taichung: {
        extras: [{ id: "taichung-extra-1", label: "台中河南路辦公室", address: "台中市河南路二段200號" }],
      },
    },
  };
  const ask = buildLineReply({
    text: "台中",
    today: "2026-09-13",
    schedule,
    profile: { profileOk: true },
  });
  assert.match(ask.text, /台中河南路辦公室/);
  assert.match(ask.text, /1 台中分公司/);

  const picked = buildLineReply({
    text: "2",
    today: "2026-09-13",
    applyCity: "台中",
    interviewCity: "台中",
    schedule,
    profile: { profileOk: true },
  });
  assert.equal(picked.actions[0].officeId, "taichung-extra-1");
  assert.match(picked.text, /請問您哪個時段可以來面試呢/);

  const book = buildLineReply({
    text: "禮拜一下午2點",
    today: "2026-09-14",
    nowHm: "10:00",
    applyCity: "台中",
    interviewCity: "台中",
    schedule,
    profile: { profileOk: true, officeId: "taichung-extra-1" },
  });
  assert.match(book.text, /河南路二段200號/);
  assert.equal(book.actions.find((a) => a.type === "book").picked.officeId, "taichung");
});

test("questions go to staff as pending", () => {
  const q = buildLineReply({
    text: "請問面試要帶什麼嗎",
    today: "2026-09-22",
    applyCity: "台中",
    profile: { profileOk: true },
  });
  assert.equal(q.actions[0].type, "human");
  assert.match(q.text, /招募同仁/);
  const book = buildLineReply({
    text: "請問可以預約面試嗎",
    today: "2026-09-22",
    profile: { profileOk: true },
  });
  assert.notEqual(book.actions[0]?.type, "human");
});

test("binds a director LINE account from a six-digit code", () => {
  assert.deepEqual(classifyBindText("綁定 123456"), { kind: "bind", code: "123456" });
  assert.deepEqual(classifyBindText("解除綁定"), { kind: "unbind" });
});

test("director notices include applicant name phone and job", () => {
  const text = composeDirectorNotice(
    "booked",
    {
      name: "王小明",
      phone: "0912345678",
      job: "社宅顧問",
      apply_city: "桃園",
      interview_date: "2026-09-16",
      start_time: "14:00",
      director_label: "中一處 黃岳澤",
    },
    { address: "桃園市中壢區環北路400號13樓之六" },
  );
  assert.match(text, /【新面試預約】/);
  assert.match(text, /王小明/);
  assert.match(text, /0912345678/);
  assert.match(text, /社宅顧問/);
  assert.match(text, /環北路400號13樓之六/);
  assert.match(composeDirectorNotice("twoh", { name: "王小明", interview_date: "2026-09-16", start_time: "14:00" }), /兩小時後/);
});
