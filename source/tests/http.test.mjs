import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../scripts/dev-server.mjs";
import { NOW, profile } from "./helpers.mjs";

test("HTTP admin authentication, CSRF, mutation, persistence and XLSX download", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "booking-http-"));
  const s = await startServer({ port: 0, dataDir: dir, clock: () => NOW });
  t.after(async () => {
    await s.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const auth = { Authorization: "Bearer " + s.token };
  assert.equal((await fetch(s.origin + "/api/admin/bookings")).status, 401);
  const home = await fetch(s.origin + "/");
  assert.equal(home.status, 200);
  assert.ok(
    home.headers
      .get("content-security-policy")
      .includes("frame-ancestors 'none'"),
  );
  assert.equal((await fetch(s.origin + "/seed.json")).status, 404);
  const list = await fetch(s.origin + "/api/admin/sessions", { headers: auth });
  assert.equal(list.status, 200);
  assert.ok((await list.json()).sessions.length > 0);
  const cid = (await s.store.candidate("U" + "a".repeat(32))).id,
    body = JSON.stringify({
      candidateId: cid,
      sessionId: "taichung_2026-09-09_1400_general",
      profile,
      confirm: true,
    });
  assert.equal(
    (
      await fetch(s.origin + "/api/admin/bookings", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body,
      })
    ).status,
    403,
  );
  const headers = {
    ...auth,
    "Content-Type": "application/json",
    Origin: s.origin,
    "X-Requested-With": "booking-admin",
    "Idempotency-Key": "http-stable-key",
  };
  const created = await fetch(s.origin + "/api/admin/bookings", {
    method: "POST",
    headers,
    body,
  });
  assert.equal(created.status, 200, await created.clone().text());
  const b = await created.json();
  assert.equal((await s.store.booking(b.id)).phone, "0900000001");
  const exported = await fetch(s.origin + "/api/admin/export.xlsx", {
    headers: auth,
  });
  assert.equal(exported.status, 200);
  assert.ok(exported.headers.get("Content-Type").includes("spreadsheetml"));
  assert.equal(
    (
      await fetch(s.origin + "/api/admin/bookings", {
        method: "POST",
        headers,
        body: "null",
      })
    ).status,
    400,
  );
});
