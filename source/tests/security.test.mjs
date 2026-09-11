import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT } from "jose";
import { createHmac } from "node:crypto";
import {
  verifyAdminJwt,
  adminIdentity,
  checkOrigin,
  readBody,
  readJson,
  verifyLineSignature,
  localMode,
  rateLimit,
} from "../src/security.mjs";
import { fixture } from "./helpers.mjs";

test("LINE signature is checked against exact raw bytes", async () => {
  const body = new TextEncoder().encode('{"text":"中文"}'),
    sig = createHmac("sha256", "secret").update(body).digest("base64");
  assert.equal(await verifyLineSignature(body, sig, "secret"), true);
  assert.equal(
    await verifyLineSignature(
      new TextEncoder().encode('{ "text":"中文"}'),
      sig,
      "secret",
    ),
    false,
  );
  assert.equal(await verifyLineSignature(body, sig, "other"), false);
  assert.equal(await verifyLineSignature(body, null, "secret"), false);
});
test("JWT requires valid signature issuer audience expiration and authorized individual", async () => {
  const pair = await generateKeyPair("RS256"),
    other = await generateKeyPair("RS256");
  const sign = (p = {}, key = pair.privateKey) =>
    new SignJWT({ email: "STAFF@example.invalid", ...p })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://team.cloudflareaccess.com")
      .setAudience("aud")
      .setSubject("user1")
      .setIssuedAt()
      .setExpirationTime(p.exp || "5m")
      .sign(key);
  const verify = (
    token,
    iss = "https://team.cloudflareaccess.com",
    aud = "aud",
    emails = ["staff@example.invalid"],
  ) => verifyAdminJwt(token, pair.publicKey, iss, aud, emails);
  assert.equal((await verify(await sign())).email, "staff@example.invalid");
  await assert.rejects(verify(await sign({}, other.privateKey)));
  await assert.rejects(verify(await sign(), "https://evil.invalid"));
  await assert.rejects(verify(await sign(), undefined, "wrong"));
  await assert.rejects(verify(await sign({ exp: 1 })));
  await assert.rejects(verify(await sign(), undefined, undefined, []), {
    code: "FORBIDDEN",
  });
  const missing = await new SignJWT({ email: "staff@example.invalid" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("https://team.cloudflareaccess.com")
    .setAudience("aud")
    .setExpirationTime("5m")
    .sign(pair.privateKey);
  await assert.rejects(verify(missing));
});
test("spoofed Access email and local token cannot bypass production JWT", async () => {
  const env = {
    APP_ENV: "production",
    ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    ACCESS_AUD: "aud",
    ADMIN_EMAILS: '["staff@example.invalid"]',
    LOCAL_DEV_TOKEN: "test",
  };
  const request = new Request("https://app.example.invalid/api/admin/me", {
    headers: {
      "Cf-Access-Authenticated-User-Email": "staff@example.invalid",
      Authorization: "Bearer test",
    },
  });
  await assert.rejects(adminIdentity(request, env), { code: "UNAUTHORIZED" });
  assert.equal(localMode(env, new URL("http://127.0.0.1")), false);
  assert.equal(
    localMode({ APP_ENV: "local" }, new URL("https://evil.invalid")),
    false,
  );
});
test("CSRF requires same origin, JSON and application header", () => {
  const env = { PUBLIC_ORIGIN: "https://app.example.invalid" },
    headers = {
      Origin: env.PUBLIC_ORIGIN,
      "Content-Type": "application/json",
      "X-Requested-With": "booking-admin",
    };
  checkOrigin(new Request(env.PUBLIC_ORIGIN, { method: "POST", headers }), env);
  for (const h of [
    { ...headers, Origin: "https://evil.invalid" },
    { ...headers, "Content-Type": "text/plain" },
    { ...headers, "X-Requested-With": "" },
  ])
    assert.throws(() =>
      checkOrigin(
        new Request(env.PUBLIC_ORIGIN, { method: "POST", headers: h }),
        env,
      ),
    );
});
test("streaming body size, malformed JSON and invalid UTF8 fail closed", async () => {
  await assert.rejects(
    readBody(new Request("http://test", { method: "POST", body: "12345" }), 4),
    { code: "BODY_TOO_LARGE" },
  );
  await assert.rejects(
    readJson(new Request("http://test", { method: "POST", body: "{bad" }), 100),
    { code: "INVALID_JSON" },
  );
  await assert.rejects(
    readJson(
      new Request("http://test", {
        method: "POST",
        body: new Uint8Array([0xff, 0xfe]),
      }),
      100,
    ),
    { code: "INVALID_JSON" },
  );
});
test("authenticated rate limit is enforced per minute", async (t) => {
  const f = await fixture(t);
  await rateLimit(f.store, "test", 2);
  await rateLimit(f.store, "test", 2);
  await assert.rejects(rateLimit(f.store, "test", 2), { code: "RATE_LIMITED" });
});
