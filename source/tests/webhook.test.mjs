import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import { fixture, signedRequest, lineEnv, NOW } from "./helpers.mjs";

async function harness(t) {
  const f = await fixture(t),
    sent = [];
  const env = lineEnv(f, async (url, opts) => {
    assert.equal(url, "https://api.line.me/v2/bot/message/reply");
    sent.push(JSON.parse(opts.body));
    return new Response("{}");
  });
  let n = 0;
  const event = (text, user = "U" + "1".repeat(32)) => ({
    type: "message",
    webhookEventId: "event-" + ++n,
    timestamp: NOW * 1000 + n,
    source: { type: "user", userId: user },
    replyToken: "reply-" + n,
    message: { id: "message-" + n, type: "text", text },
  });
  const dispatch = async (e) => {
    const response = await worker.fetch(
      signedRequest({ destination: env.LINE_DESTINATION_ID, events: [e] }),
      env,
    );
    assert.equal(response.status, 200, await response.text());
    return sent.at(-1)?.messages[0];
  };
  const text = async (value) => dispatch(event(value));
  const click = async (label, user) => {
    const action = sent
      .at(-1)
      .messages[0].quickReply.items.find(
        (i) => i.action.label === label,
      )?.action;
    assert.ok(action, "Missing button " + label);
    const e = event("", user);
    delete e.message;
    e.type = "postback";
    e.postback = { data: action.data };
    return { event: e, message: await dispatch(e) };
  };
  return { ...f, env, sent, event, dispatch, text, click };
}
test("signed LINE full booking, duplicate confirmation, query and cancellation", async (t) => {
  const h = await harness(t);
  await h.text("預約面試");
  await h.click("社宅顧問");
  await h.click("台中");
  await h.text("測試甲");
  await h.text("0900000001");
  await h.click("略過");
  const date = h.sent.at(-1).messages[0].quickReply.items[0].action.label;
  await h.click(date);
  await h.click("11:00");
  const confirmation = await h.click("確認預約");
  assert.match(confirmation.message.text, /預約/);
  assert.equal((await h.store.listBookings({})).length, 1);
  const deliveries = h.sent.length;
  await h.dispatch(confirmation.event);
  assert.equal(h.sent.length, deliveries);
  await h.click("我的預約");
  await h.click("取消預約");
  await h.click("確認取消");
  assert.equal((await h.store.listBookings({}))[0].status, "cancelled");
});
test("Nantou interview routes to Changhua preserving application city", async (t) => {
  const h = await harness(t);
  await h.text("預約");
  await h.click("儲備主管");
  await h.click("南投");
  await h.click("彰化分公司");
  await h.text("測試乙");
  await h.text("0900000002");
  await h.click("略過");
  const d = h.sent.at(-1).messages[0].quickReply.items[0].action.label;
  await h.click(d);
  await h.click("14:00");
  await h.click("確認預約");
  const b = (await h.store.listBookings({}))[0];
  assert.equal(b.apply_city, "南投");
  assert.equal(b.office_id, "changhua");
});
test("unknown question requests human once, then suppresses until explicit resume", async (t) => {
  const h = await harness(t);
  await h.text("這個問題不在罐頭裡");
  const cid = (await h.store.first("SELECT id FROM candidates")).id;
  assert.equal((await h.store.conversation(cid)).mode, "pending_human");
  const before = h.sent.length;
  await h.text("預約");
  assert.equal(h.sent.length, before);
  await h.store.withLock("candidate:" + cid, (l) =>
    h.store.setMode(cid, "auto", "staff", l),
  );
  await h.text("預約");
  assert.equal(h.sent.length, before + 1);
});
test("administrative FAQ is human, never general salary claim", async (t) => {
  const h = await harness(t);
  await h.text("預約");
  await h.click("行政職");
  await h.text("薪資");
  assert.equal(
    (await h.store.first("SELECT mode FROM conversations")).mode,
    "pending_human",
  );
  assert.doesNotMatch(h.sent.at(-1).messages[0].text, /論件計酬/);
});
test("buttons bound to candidate, revision and expiration", async (t) => {
  const h = await harness(t);
  await h.text("預約");
  const raw = h.sent.at(-1).messages[0].quickReply.items[0].action.data;
  const e = h.event("", "U" + "2".repeat(32));
  delete e.message;
  e.type = "postback";
  e.postback = { data: raw };
  await h.dispatch(e);
  assert.match(h.sent.at(-1).messages[0].text, /失效/);
  const own = h.event("");
  delete own.message;
  own.type = "postback";
  own.postback = { data: raw };
  await h.dispatch(own);
  await h.dispatch({
    ...own,
    webhookEventId: "old-button-second",
    timestamp: own.timestamp + 1,
  });
  assert.match(h.sent.at(-1).messages[0].text, /失效/);
});
test("wrong signature, destination and launch gate block processing", async (t) => {
  const h = await harness(t),
    body = {
      destination: h.env.LINE_DESTINATION_ID,
      events: [h.event("預約")],
    };
  assert.equal(
    (await worker.fetch(signedRequest(body, "wrong"), h.env)).status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(
        signedRequest({ ...body, destination: "wrong" }),
        h.env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await worker.fetch(signedRequest(body), {
        ...h.env,
        LAUNCH_APPROVED: "false",
      })
    ).status,
    503,
  );
  assert.equal(h.sent.length, 0);
  assert.equal((await h.store.all("SELECT * FROM candidates")).length, 0);
  assert.equal(
    (
      await worker.fetch(signedRequest({ ...body, events: [] }), {
        ...h.env,
        LAUNCH_APPROVED: "false",
      })
    ).status,
    200,
  );
});
test("out-of-order events do not overwrite newer conversation state", async (t) => {
  const h = await harness(t);
  await h.text("預約");
  await h.click("社宅顧問");
  const before = h.sent.length;
  const e = h.event("bad");
  e.timestamp = NOW * 1000;
  await h.dispatch(e);
  assert.equal(h.sent.length, before);
  assert.equal(
    (await h.store.first("SELECT step FROM conversations")).step,
    "city",
  );
});
test("LINE timeout recorded uncertain, no Push and no automatic duplicate delivery", async (t) => {
  const h = await harness(t);
  let count = 0;
  h.env.LINE_FETCH = async () => {
    count++;
    throw Error("network");
  };
  const e = h.event("預約");
  await h.dispatch(e);
  await h.dispatch(e);
  assert.equal(count, 1);
  assert.equal(
    (await h.store.first("SELECT delivery_status FROM webhook_events"))
      .delivery_status,
    "uncertain",
  );
});
