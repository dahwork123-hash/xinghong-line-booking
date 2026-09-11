import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backup } from "node:sqlite";
import { createDatabase } from "../scripts/sqlite-adapter.mjs";
import { Store } from "../src/store.mjs";
import { fixture, book, NOW } from "./helpers.mjs";
test("local SQLite snapshot restore preserves booking, audit, settings and human mode", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "booking-restore-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const f = await fixture(null);
  let restored;
  try {
    const cid = await f.candidate(),
      b = await book(f, cid);
    await f.store.withLock("candidate:" + cid, (l) =>
      f.store.setMode(cid, "human", "staff", l),
    );
    await backup(f.db.raw, path.join(dir, "backup.sqlite"));
    restored = createDatabase(path.join(dir, "backup.sqlite"));
    const s = new Store(restored, () => NOW);
    assert.equal((await s.booking(b.id)).phone, "0900000001");
    assert.equal((await s.conversation(cid)).mode, "human");
    assert.equal((await s.setting("schedules")).revision, 1);
    assert.equal((await s.all("SELECT * FROM booking_events")).length, 1);
    assert.equal((await s.all("PRAGMA foreign_key_check")).length, 0);
  } finally {
    restored?.close();
    f.db.close();
  }
});
