import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer } from "./dev-server.mjs";
import { NOW, profile } from "../tests/helpers.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "booking-browser-"));
const service = await startServer({ port: 0, dataDir: dir, clock: () => NOW });
let browser;
const checks = [],
  errors = [];
try {
  await service.store.ensureSessions();
  const cid = (await service.store.candidate("U" + "a".repeat(32))).id;
  await service.store.withLock("candidate:" + cid, (l) =>
    service.store.mutateBooking(
      {
        candidateId: cid,
        sessionId: "taichung_2026-09-09_1400_general",
        profile: { ...profile, name: "畫面測試甲" },
        key: crypto.randomUUID(),
        actor: "test@example.invalid",
        actorKind: "admin",
      },
      l,
    ),
  );
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    }),
    page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(service.origin);
  await page.locator("#login-form input").fill(service.token);
  await page.getByRole("button", { name: "進入本機審查" }).click();
  await page.getByRole("heading", { name: "場次總覽", exact: true }).waitFor();
  checks.push("real login and persistent session overview");
  await fs.mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/admin-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "預約查詢", exact: true }).click();
  await page.getByText("畫面測試甲", { exact: false }).waitFor();
  await page.getByRole("button", { name: "明細", exact: true }).click();
  await page.getByRole("heading", { name: "預約明細" }).waitFor();
  await page.getByRole("button", { name: "人工接手", exact: true }).click();
  assert.equal((await service.store.conversation(cid)).mode, "human");
  await page.locator("#dialog-close").click();
  checks.push("booking detail and durable human handoff");
  await page
    .getByRole("button", { name: "人工接手／代約", exact: true })
    .click();
  await page.getByRole("button", { name: "恢復自動", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("已恢復自動"),
  );
  assert.equal((await service.store.conversation(cid)).mode, "auto");
  checks.push("explicit automatic resume");
  await page.getByRole("button", { name: "處長與時間", exact: true }).click();
  await page.getByRole("heading", { name: "處長與面試時間" }).waitFor();
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("排程草稿已儲存"),
  );
  checks.push("schedule draft via backend API");
  await page.getByRole("button", { name: "罐頭管理", exact: true }).click();
  await page.locator("#template-text").fill("測試核定薪資內容，請由主管說明。");
  await page.getByRole("button", { name: "預覽發布", exact: true }).click();
  await page.getByRole("button", { name: "確認發布", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("罐頭已發布"),
  );
  assert.equal(
    (await service.store.setting("templates")).value.salary_general.text,
    "測試核定薪資內容，請由主管說明。",
  );
  checks.push("canned reply preview and publication");
  await page.getByRole("button", { name: "預約查詢", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出 Excel" }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "interview-bookings.xlsx");
  checks.push("real browser XLSX download");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/admin-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "mobile page must not overflow",
  );
  checks.push("390px viewport without page overflow");
  await page.getByRole("button", { name: "場次總覽", exact: true }).click();
  await page
    .getByRole("button", { name: "容量／停辦", exact: true })
    .first()
    .click();
  await page.screenshot({
    path: "test-results/admin-mobile-dialog.png",
    fullPage: true,
  });
  assert.ok(
    await page
      .locator("#dialog")
      .evaluate((el) => el.getBoundingClientRect().width <= innerWidth),
  );
  checks.push("mobile editable session dialog");
  assert.deepEqual(errors, []);
  checks.push("no browser JavaScript errors");
  await fs.writeFile(
    "test-results/browser.json",
    JSON.stringify(
      {
        status: "passed",
        checks,
        errors,
        screenshots: [
          "admin-desktop.png",
          "admin-mobile.png",
          "admin-mobile-dialog.png",
        ],
        data: "synthetic only",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "passed", checks }));
} finally {
  await browser?.close();
  await service.close();
  await fs.rm(dir, { recursive: true, force: true });
}
