import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixture, book, profile, NOW } from "./helpers.mjs";

async function race(filename, inputs) {
  const workers = inputs.map(
    (input) =>
      new Worker(new URL("./concurrency-worker.mjs", import.meta.url), {
        workerData: { filename, input, now: NOW },
      }),
  );
  try {
    await Promise.all(
      workers.map(
        (w) =>
          new Promise((resolve, reject) => {
            w.once("message", resolve);
            w.once("error", reject);
          }),
      ),
    );
    const results = workers.map(
      (w) =>
        new Promise((resolve, reject) => {
          w.once("message", resolve);
          w.once("error", reject);
        }),
    );
    for (const w of workers) w.postMessage("go");
    return await Promise.all(results);
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
}
test("independent SQLite connections competing for last seat: exactly one wins", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "booking-race-")),
    filename = path.join(dir, "db.sqlite");
  const f = await fixture(null, filename);
  t.after(async () => {
    f.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 4; i++) await book(f, await f.candidate());
  const inputs = [];
  for (let i = 0; i < 2; i++)
    inputs.push({
      candidateId: await f.candidate(),
      sessionId: "taichung_2026-09-09_1400_general",
      profile,
      actor: "race",
      actorKind: "admin",
      key: crypto.randomUUID(),
    });
  const results = await race(filename, inputs);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.find((r) => !r.ok).code, "SLOT_FULL");
  assert.equal((await f.store.listBookings({})).length, 5);
});
test("independent concurrent requests for one LINE identity cannot create two active bookings", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "booking-person-")),
    filename = path.join(dir, "db.sqlite");
  const f = await fixture(null, filename);
  t.after(async () => {
    f.db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const cid = await f.candidate(),
    inputs = [
      "taichung_2026-09-09_1400_general",
      "taichung_2026-09-10_1400_general",
    ].map((sessionId) => ({
      candidateId: cid,
      sessionId,
      profile,
      actor: "race",
      actorKind: "admin",
      key: crypto.randomUUID(),
    }));
  const results = await race(filename, inputs);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(
    ["BUSY", "ACTIVE_BOOKING_EXISTS"].includes(results.find((r) => !r.ok).code),
  );
  assert.equal((await f.store.listBookings({})).length, 1);
});
