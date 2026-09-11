import test from "node:test";
import assert from "node:assert/strict";
import { fixture, lineEnv, signedRequest, NOW } from "./helpers.mjs";
import worker from "../src/worker.mjs";

test("webhook queues a batch only after signature validation; consumer acknowledges persisted response", async (t) => {
  const f = await fixture(t),
    queued = [],
    sent = [];
  const env = lineEnv(f, async (u, o) => {
    sent.push(JSON.parse(o.body));
    return new Response("{}");
  });
  env.LINE_EVENTS = {
    async sendBatch(messages) {
      queued.push(...messages);
    },
  };
  const events = Array.from({ length: 3 }, (_, i) => ({
    type: "message",
    timestamp: NOW * 1000 + i,
    webhookEventId: "queue-event-" + i,
    source: { type: "user", userId: "U" + String(i + 1).padStart(32, "0") },
    replyToken: "r" + i,
    message: { type: "text", id: "m" + i, text: "預約" },
  }));
  const body = { destination: env.LINE_DESTINATION_ID, events };
  assert.equal(
    (await worker.fetch(signedRequest(body, "bad"), env)).status,
    401,
  );
  assert.equal(queued.length, 0);
  assert.equal((await worker.fetch(signedRequest(body), env)).status, 200);
  assert.equal(queued.length, 3);
  assert.equal(sent.length, 0);
  let ack = 0,
    retry = 0;
  for (const q of queued)
    await worker.queue(
      {
        messages: [
          {
            body: q.body,
            id: "q",
            attempts: 1,
            ack: () => ack++,
            retry: () => retry++,
          },
        ],
      },
      env,
    );
  assert.equal(ack, 3);
  assert.equal(retry, 0);
  assert.equal(sent.length, 3);
});
test("queue delay beyond reply budget requests human without mutating booking", async (t) => {
  const f = await fixture(t),
    env = lineEnv(f);
  let ack = 0;
  const event = {
    type: "message",
    timestamp: NOW * 1000 - 60000,
    webhookEventId: "late-queue",
    source: { type: "user", userId: "U" + "a".repeat(32) },
    message: { type: "text", text: "預約" },
  };
  await worker.queue(
    {
      messages: [
        {
          id: "q",
          attempts: 1,
          body: { event, receivedAt: NOW - 46 },
          ack: () => ack++,
          retry: () => assert.fail("unexpected retry"),
        },
      ],
    },
    env,
  );
  assert.equal(ack, 1);
  assert.equal(
    (await f.store.first("SELECT mode FROM conversations")).mode,
    "pending_human",
  );
  assert.equal(
    (await f.store.first("SELECT delivery_status FROM webhook_events"))
      .delivery_status,
    "queue_expired",
  );
});
test("queue database failure retries rather than acknowledging lost work", async (t) => {
  const f = await fixture(t),
    env = { ...lineEnv(f), LAUNCH_APPROVED: "false" };
  let retried = 0;
  await worker.queue(
    {
      messages: [
        {
          id: "q",
          attempts: 1,
          body: { event: {}, receivedAt: NOW },
          ack: () => assert.fail("must not ack"),
          retry: () => retried++,
        },
      ],
    },
    env,
  );
  assert.equal(retried, 1);
});
