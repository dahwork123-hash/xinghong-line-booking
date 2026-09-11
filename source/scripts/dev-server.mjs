import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import worker from "../src/worker.mjs";
import { Store } from "../src/store.mjs";
import { createDatabase } from "./sqlite-adapter.mjs";

export async function startServer(options = {}) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = options.dataDir || path.join(root, ".local");
  await fs.mkdir(dataDir, { recursive: true });
  const db = createDatabase(
    options.database || path.join(dataDir, "booking.sqlite"),
  );
  if (
    !db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
      )
      .get()
  )
    db.exec(
      await fs.readFile(path.join(root, "migrations/0001_initial.sql"), "utf8"),
    );
  const store = new Store(db, options.clock);
  await store.initialize();
  const token = options.token || randomBytes(32).toString("base64url");
  const env = {
    DB: db,
    APP_ENV: "local",
    LOCAL_DEV_TOKEN: token,
    LAUNCH_APPROVED: options.lineTesting ? "true" : "false",
    PRIVACY_NOTICE: "本機假資料測試。請勿輸入真實個資。",
    CLOCK: options.clock,
    LINE_CHANNEL_SECRET:
      options.lineSecret || "local-test-signing-secret-not-for-production",
    LINE_CHANNEL_ACCESS_TOKEN: "local-not-a-real-line-token",
    LINE_DESTINATION_ID: "U00000000000000000000000000000000",
    LINE_FETCH:
      options.lineFetch || (async () => new Response("{}", { status: 200 })),
    ASSETS: {
      async fetch(request) {
        const file =
          new URL(request.url).pathname === "/"
            ? "index.html"
            : new URL(request.url).pathname.slice(1);
        if (!["index.html", "app.js", "style.css"].includes(file))
          return new Response("Not found", { status: 404 });
        const body = await fs.readFile(path.join(root, "public", file));
        return new Response(body, {
          headers: {
            "Content-Type": file.endsWith(".js")
              ? "text/javascript; charset=utf-8"
              : file.endsWith(".css")
                ? "text/css; charset=utf-8"
                : "text/html; charset=utf-8",
          },
        });
      },
    },
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = env.PUBLIC_ORIGIN + req.url;
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method)
          ? { body: req, duplex: "half" }
          : {}),
      });
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end("Local server error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8788, "127.0.0.1", resolve);
  });
  env.PUBLIC_ORIGIN = "http://127.0.0.1:" + server.address().port;
  return {
    server,
    db,
    store,
    env,
    token,
    origin: env.PUBLIC_ORIGIN,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const service = await startServer({ port: Number(process.env.PORT || 8788) });
  console.log(
    `Local review only: ${service.origin}\nLocal login code: ${service.token}\nNo real LINE messages are sent. Do not expose this server to the internet.`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await service.close();
      process.exit(0);
    });
}
