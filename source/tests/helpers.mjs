import fs from "node:fs/promises";
import { createHmac } from "node:crypto";
import { createDatabase } from "../scripts/sqlite-adapter.mjs";
import { Store } from "../src/store.mjs";
import { startsAt } from "../src/domain.mjs";

export const NOW = startsAt("2026-09-08", "08:00");
export const profile = {
  name: "測試求職者",
  phone: "0900000001",
  jobId: "housing_advisor",
  applyCity: "台中",
  source: "未知",
};
export async function fixture(t, filename = ":memory:") {
  const db = createDatabase(filename);
  db.exec(
    await fs.readFile(
      new URL("../migrations/0001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  let now = NOW;
  const store = new Store(db, () => now);
  await store.initialize();
  await store.ensureSessions();
  t?.after(() => db.close());
  let count = 0;
  return {
    db,
    store,
    setTime: (n) => (now = n),
    async candidate() {
      return (await store.candidate("U" + String(++count).padStart(32, "0")))
        .id;
    },
  };
}
export async function book(
  f,
  cid,
  sid = "taichung_2026-09-09_1400_general",
  extra = {},
) {
  const input = {
    candidateId: cid,
    sessionId: sid,
    profile,
    key: crypto.randomUUID(),
    actor: "test@example.invalid",
    actorKind: "admin",
    ...extra,
  };
  return f.store.withLock("candidate:" + cid, (lock) =>
    f.store.mutateBooking(input, lock),
  );
}
export function signedRequest(
  body,
  secret = "test-secret",
  origin = "https://test.example.invalid",
) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(origin + "/webhooks/line", {
    method: "POST",
    body: text,
    headers: {
      "x-line-signature": createHmac("sha256", secret)
        .update(text)
        .digest("base64"),
    },
  });
}
export function lineEnv(f, send = async () => new Response("{}")) {
  return {
    DB: f.db,
    APP_ENV: "staging",
    PUBLIC_ORIGIN: "https://test.example.invalid",
    CLOCK: f.store.clock,
    LINE_CHANNEL_SECRET: "test-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "fake-token",
    LINE_DESTINATION_ID: "U" + "0".repeat(32),
    LAUNCH_APPROVED: "true",
    PRIVACY_NOTICE: "僅供自動測試，請勿填真實個資。",
    LINE_FETCH: send,
  };
}
