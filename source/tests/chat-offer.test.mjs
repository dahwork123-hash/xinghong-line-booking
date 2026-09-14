import test from "node:test";
import assert from "node:assert/strict";
import {
  composeOffer,
  composeConfirm,
  composeReminder,
  parseTimeReply,
  buildLineReply,
  classifyLineText,
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
  assert.match(text, /台中市北屯區文心路四段698號6樓之1/);
  assert.match(text, /請問您哪個時段可以來面試呢\?/);
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
  const book = buildLineReply({
    text: "您好，禮拜一下午2點可以，謝謝",
    today: "2026-09-11",
    nowHm: "22:00",
  });
  assert.equal(book.actions[0].type, "book");
  assert.equal(book.actions[0].picked.start, "14:00");
  const paused = buildLineReply({ text: "預約面試", today: "2026-09-13", humanMode: true });
  assert.equal(paused.silent, true);
  const custom = buildLineReply({
    text: "預約面試",
    today: "2026-09-13",
    customOffer: "自訂約訪文案",
  });
  assert.equal(custom.text, "自訂約訪文案");
});
