import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { Store } from "../src/store.mjs";
import { profile, NOW } from "../tests/helpers.mjs";
import { seed } from "../src/domain.mjs";

test("Cloudflare workerd bundle, D1 migrations, rollback and export run locally", async (t) => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "review",
          modules: true,
          scriptPath: ".build/worker.js",
          compatibilityDate: "2026-09-08",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: { DB: "test-db" },
          bindings: {
            APP_ENV: "local",
            PUBLIC_ORIGIN: "http://127.0.0.1:8788",
            LOCAL_DEV_TOKEN: "workerd-test-token",
            LAUNCH_APPROVED: "false",
          },
          serviceBindings: { ASSETS: () => new Response("static") },
        },
      ],
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  for (const file of ["0001_initial.sql", "0002_seed.sql"]) {
    const queries = unstable_splitSqlQuery(
      await fs.readFile(
        new URL("../migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
    await db.batch(queries.map((sql) => db.prepare(sql)));
  }
  const store = new Store(db, () => NOW);
  await store.ensureSessions();
  for (let i = 0; i < 5; i++) {
    const cid = (await store.candidate("U" + String(i + 1).padStart(32, "0")))
      .id;
    await store.withLock("candidate:" + cid, (l) =>
      store.mutateBooking(
        {
          candidateId: cid,
          sessionId: "taichung_2026-09-09_1400_general",
          profile,
          actor: "runtime",
          actorKind: "admin",
          key: crypto.randomUUID(),
        },
        l,
      ),
    );
  }
  const cid = (await store.candidate("U" + "a".repeat(32))).id;
  await assert.rejects(
    store.withLock("candidate:" + cid, (l) =>
      store.mutateBooking(
        {
          candidateId: cid,
          sessionId: "taichung_2026-09-09_1400_general",
          profile,
          actor: "runtime",
          actorKind: "admin",
          key: crypto.randomUUID(),
        },
        l,
      ),
    ),
    { code: "SLOT_FULL" },
  );
  assert.equal((await store.all("SELECT * FROM operations")).length, 5);
  await store.publishSchedule(
    { revision: 1, effectiveDate: "2026-09-08", rules: seed.weeklySchedules },
    "runtime",
  );
  const auth = { Authorization: "Bearer workerd-test-token" };
  const me = await mf.dispatchFetch("http://127.0.0.1:8788/api/admin/me", {
    headers: auth,
  });
  assert.equal(me.status, 200, await me.clone().text());
  const out = await mf.dispatchFetch(
    "http://127.0.0.1:8788/api/admin/export.xlsx?from=2026-09-08&to=2026-09-21",
    { headers: auth },
  );
  assert.equal(out.status, 200, await out.clone().text());
  assert.equal(
    Buffer.from(await out.arrayBuffer())
      .subarray(0, 2)
      .toString(),
    "PK",
  );
  const unauthorized = await mf.dispatchFetch(
    "http://127.0.0.1:8788/api/admin/bookings",
  );
  assert.equal(unauthorized.status, 401);
});
