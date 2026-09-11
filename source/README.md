# 星鴻 LINE 面試預約：上線前原始碼審查包

版本：0.1.0-rc.1｜日期：2026-09-08｜官方帳號：@064lhzfu

**這次交付包含真正可執行的前後端原始碼，不只是企劃書。狀態是 release candidate（上線前審查版），不是已上線服務，也不是已通過獨立安全稽核的成品。**

## 先看這裡

1. 工程同仁先看本檔、[SECURITY.md](SECURITY.md)、[ARCHITECTURE.md](ARCHITECTURE.md)。
2. 執行下面的本機測試；正式部署看 [DEPLOYMENT.md](DEPLOYMENT.md)。
3. 驗證紀錄在 [VERIFICATION.md](VERIFICATION.md)；交接給 AI 使用 [AI_HANDOFF.md](AI_HANDOFF.md)。
4. 舊規劃與 24 頁簡報另附 `planning-reference/`（只在完整交付 ZIP 內）。那是 H1 時點的流程示意，不是本次後端程式的上線證據。

## 已有的程式

| 功能 | 原始碼位置 | 首版行為 |
|---|---|---|
| LINE 自動預約 | `src/line.mjs` | 職務、應徵地、面試地、姓名、電話、選填來源、日期時間、最後確認 |
| Webhook 安全 | `src/security.mjs` | 原始 bytes HMAC 驗簽、目的帳號驗證、大小限制 |
| 非同步處理 | `src/worker.mjs` | 驗簽後才送 Queue；每個 consumer 一事件；持久化去重、人工接手 |
| 預約交易 | `src/store.mjs`、`migrations/0001_initial.sql` | 容量檢查與寫入同交易；一人一筆未來預約；改期失敗不取消原約 |
| 管理後台 | `public/`、`src/worker.mjs` | 真正 API、資料庫、全區查詢、統計、人工接手與代約 |
| 場次與罐頭 | `src/store.mjs` | 草稿、版本衝突、發布、停辦、容量與臨時加場 |
| Excel | `src/export.mjs` | 真正 XLSX、篩選結果全筆匯出、電話文字型態、防公式注入 |
| 個資保留 | `Store.retention()` | 面試日期後一年分批刪除；短期草稿與事件回覆另有到期時間 |
| 管理者身分 | `src/security.mjs` | Cloudflare Access JWT 簽章、issuer、audience、效期與公司信箱白名單 |
| 測試 | `tests/`、`tests-runtime/` | 可重跑，不含真實求職者資料與金鑰 |

## 本機啟動

解壓到英文路徑較方便，例如 Windows `C:\src\xinghong-line-booking` 或 Linux `~/src/xinghong-line-booking`。不要在同步中的 OneDrive 資料夾長期運行 SQLite。檔案內容是 UTF-8 繁體中文，檔名全部 ASCII。

安裝 Node.js 24 與 pnpm 11.19.0 後，在 `source/` 目錄執行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm dev
```

瀏覽 `http://127.0.0.1:8788`，輸入終端顯示的一次啟動本機審查代碼。若埠被占用，可設定 `PORT=8798` 再執行 `pnpm dev`（PowerShell：`$env:PORT='8798'`）。

本機只綁定 127.0.0.1，資料寫入 `.local/booking.sqlite`。本機 LINE 外送是 mock，不會聯絡真正 LINE API；預設也不接受預約 Webhook。本機入口不是正式部署方式，不能直接開防火牆提供外網使用。

進一步測試：

```sh
pnpm build
pnpm test:cloudflare
pnpm exec playwright install chromium
pnpm test:browser
pnpm audit
```

Cloudflare 測試使用本機 workerd/D1 模擬環境，不建立遠端資源。已有 Edge 的 Windows 可以先設定 `$env:BROWSER_CHANNEL='msedge'`，不必另下載 Chromium。

若平台因 `--ignore-scripts` 缺少 esbuild/workerd binary，先由工程同仁核對套件來源與安裝腳本，再針對該套件允許執行；不要為了安裝方便全面放行未知 postinstall。

## 不要誤會的界線

- `seed.json` 是已確認規則與預設罐頭；資料庫初始化後，時段和罐頭以已發布設定為準。
- 確定採 Cloudflare Workers + D1 + Queues + Access 作為這份程式的實作方案。這是技術選擇，不代表已開通任何帳號或同意付費。
- 仍需公司帳號、可用 HTTPS 網域、分離的 staging/production DB、Queue、Access、LINE 測試帳號及正式 Channel 設定。
- 沒有串接 ChatGPT/Claude/API，也不使用現有訂閱作為後端 API 配額。雲端、網域、LINE 訊息額度與維運成本需上線前確認，不能保證永遠零費用。
- 正式環境預設 `LAUNCH_APPROVED=false`、`RETENTION_ENABLED=false`，不可跳過上線檢查。
- 沒有搬舊個資、出勤／未到、提醒推播、第二套聊天收件匣、主管審核或不受限制的系統超額代約。
- 這次沒有登入正式 LINE、查看未讀對話、寄出求職訊息、上傳個資或部署遠端服務。

## 編碼處理

原 H1 ZIP 抽查的中央目錄 UTF-8 旗標與 UTF-8 檔名字節均有效，不能確定是壓縮檔標頭損壞。截圖顯示的是接收端解壓後「檔名」無效編碼。

新 ZIP 改採全英文 ASCII 檔名／目錄／壓縮檔名稱，文字內容仍是 UTF-8 繁體中文，並同步改寫文件連結。詳見完整包 `ENCODING-FIX.md`。這避免中文檔名在 Windows 與 Linux 解壓工具間的編碼判讀差異；不必再逐檔手動更名。
