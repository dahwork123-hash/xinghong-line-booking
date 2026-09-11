import { createRemoteJWKSet, jwtVerify } from "jose";
import { AppError, invariant, epoch, sha } from "./domain.mjs";

const remoteKeys = new Map();
export async function verifyAdminJwt(token, keyset, issuer, audience, emails) {
  const { payload } = await jwtVerify(token, keyset, {
    issuer,
    audience,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "email"],
    clockTolerance: 5,
  });
  invariant(
    typeof payload.email === "string" && typeof payload.sub === "string",
    "UNAUTHORIZED",
    401,
  );
  invariant(
    typeof payload.iat === "number" && payload.iat <= epoch() + 5,
    "UNAUTHORIZED",
    401,
  );
  invariant(emails.includes(payload.email.toLowerCase()), "FORBIDDEN", 403);
  return { id: payload.sub, email: payload.email.toLowerCase() };
}
export function localMode(env, url) {
  return (
    env.APP_ENV === "local" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}
export async function adminIdentity(request, env) {
  const url = new URL(request.url);
  if (localMode(env, url) && env.LOCAL_DEV_TOKEN) {
    invariant(
      await constantEqual(
        request.headers.get("Authorization") || "",
        `Bearer ${env.LOCAL_DEV_TOKEN}`,
      ),
      "UNAUTHORIZED",
      401,
    );
    return { id: "local-reviewer", email: "local-reviewer@example.invalid" };
  }
  invariant(
    /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(
      env.ACCESS_TEAM_DOMAIN || "",
    ) && env.ACCESS_AUD,
    "SERVICE_NOT_READY",
    503,
  );
  let emails;
  try {
    emails = JSON.parse(env.ADMIN_EMAILS);
  } catch {
    throw new AppError("SERVICE_NOT_READY", 503);
  }
  invariant(
    Array.isArray(emails) &&
      emails.length > 0 &&
      emails.every((e) => typeof e === "string"),
    "SERVICE_NOT_READY",
    503,
  );
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  invariant(token && token.length < 12000, "UNAUTHORIZED", 401);
  let keyset = remoteKeys.get(env.ACCESS_TEAM_DOMAIN);
  if (!keyset) {
    keyset = createRemoteJWKSet(
      new URL(env.ACCESS_TEAM_DOMAIN + "/cdn-cgi/access/certs"),
      { timeoutDuration: 4000, cooldownDuration: 30000 },
    );
    remoteKeys.set(env.ACCESS_TEAM_DOMAIN, keyset);
  }
  try {
    return await verifyAdminJwt(
      token,
      keyset,
      env.ACCESS_TEAM_DOMAIN,
      env.ACCESS_AUD,
      emails.map((e) => e.toLowerCase()),
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("UNAUTHORIZED", 401);
  }
}
export async function constantEqual(a, b) {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  let result = 0;
  for (let i = 0; i < x.length; i++)
    result |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return result === 0;
}
export function checkOrigin(request, env) {
  if (["GET", "HEAD"].includes(request.method)) return;
  invariant(
    request.headers.get("Origin") === env.PUBLIC_ORIGIN,
    "FORBIDDEN",
    403,
  );
  invariant(
    request.headers.get("Content-Type")?.split(";")[0].trim() ===
      "application/json",
    "INVALID_INPUT",
    415,
  );
  invariant(
    request.headers.get("X-Requested-With") === "booking-admin",
    "FORBIDDEN",
    403,
  );
}
export async function readBody(request, limit = 65536) {
  if (Number(request.headers.get("Content-Length")) > limit)
    throw new AppError("BODY_TOO_LARGE", 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new AppError("BODY_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
export async function readJson(request, limit) {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readBody(request, limit),
      ),
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("INVALID_JSON", 400);
  }
}
export async function verifyLineSignature(bytes, signature, secret) {
  if (
    !secret ||
    typeof signature !== "string" ||
    !/^[A-Za-z0-9+/]{43}=$/.test(signature)
  )
    return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const decoded = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", key, decoded, bytes);
  } catch {
    return false;
  }
}
export async function rateLimit(store, key, max = 60) {
  const now = store.clock(),
    minute = Math.floor(now / 60),
    bucket = key + ":" + minute;
  const r = await store.run(
    "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    bucket,
    now + 86400,
  );
  void r;
  const count = await store.first(
    "SELECT count FROM rate_limits WHERE key=?",
    bucket,
  );
  invariant(count.count <= max, "RATE_LIMITED", 429);
}
export function securityHeaders(response) {
  const h = new Headers(response.headers);
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  h.set(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
  );
  h.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, headers: h });
}
