# 部署與上線操作手冊

## 0. 先決條件與停止線

目前未建遠端資源、未登入正式LINE、未核實正式帳號後台現在的Webhook／回覆開關。不能把本機啟動成功當成可直接切換正式帳號。

先確認：

- 公司持有 Cloudflare 帳號、2FA、負責人、公司可用網域及 DNS 權限，不使用外包或個人私有資源作為唯一管理者。
- 分離測試 LINE OA、staging D1/Queue、production D1/Queue。真求職者只在正式環境，測試全部用假資料。
- 公司核定隱私告知（蒐集目的、欄位、保存期、聯絡窗口、存取／刪除方法、受託雲端處理），填入 `PRIVACY_NOTICE`。
- 2至3位同仁各自的公司信箱白名單，不共用管理帳號。離職撤權有負責人。
- 附 [SECURITY.md](SECURITY.md) 審查與 [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) 簽核。
- D1/Queues/Access 的方案、網域、CPU時間、訊息用量與告警，由公司確認可接受成本。現有聊天AI訂閱不等於雲端託管或LINE訊息額度。

## 1. 本機安裝與驗證

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm build
pnpm test:cloudflare
pnpm audit
```

瀏覽器驗證另執行 `pnpm exec playwright install chromium`、`pnpm test:browser`。Windows 有Edge可設環境變數 `BROWSER_CHANNEL=msedge`。

`pnpm build` 是 staging 的 **dry-run**，不部署。不需要 LINE 金鑰。`pnpm test:cloudflare` 使用產生的 `.build/worker.js`；每次修改程式都要先重新 build。

## 2. 公司帳號及基礎資源（部署人員操作）

以下是未代為執行的指令。先由公司負責人登入，密碼及驗證碼自行輸入，不要傳給AI。

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm exec wrangler d1 create xinghong-booking-staging
pnpm exec wrangler d1 create xinghong-booking-production
pnpm exec wrangler queues create xinghong-line-staging
pnpm exec wrangler queues create xinghong-line-staging-dlq
pnpm exec wrangler queues create xinghong-line-production
pnpm exec wrangler queues create xinghong-line-production-dlq
```

`wrangler.jsonc` 各環境 `d1_databases` 的名稱與ID改成相對應實際值。現檔內 `booking-db` 是示意別名；若改成上面實際名稱，package scripts 的 DB 命令一併改名。不要把 staging 與 production 填成相同 database_id。`migrations_dir` 保持 `migrations`。

Queues consumer 必須 `max_batch_size:1`、`max_batch_timeout:0`、`max_retries:3`，保留DLQ，不要改回10筆批次。Queue 每個事件獨立執行，避免多個事件合併超出單次D1查詢額度。部署前檢查該帳號的 Queues 保留時間與失敗訊息處理規範。

## 3. HTTPS 與 Access

1. 在每個環境的 `routes` 設公司管理的 Custom Domain，例如 `[{"pattern":"recruit-staging.company.example","custom_domain":true}]`。範例網域不能照抄使用。
2. `PUBLIC_ORIGIN` 必須為該網域的 `https://...`，不可有路徑或尾端斜線。
3. 用 Cloudflare Zero Trust 建立該網域的 self-hosted Access application，僅允許核定的個別同仁信箱／公司身分提供者，建議要求MFA及較短登入時效。
4. 在相同主機上針對 **精確 `/webhooks/line` 路徑** 建立更具體的 Access Bypass policy/application，使 LINE 能到達端點；其他頁面及 `/api/admin/*` 仍受Access保護。不要對整個網域設定 Bypass 或 Everyone。
5. 應用內另驗證 `Cf-Access-Jwt-Assertion`，包括公開金鑰簽章、issuer、audience、exp、iat、sub、email及白名單；只放通Email header不夠。
6. `workers_dev` 和 `preview_urls` 保持 false。確認沒有其他可繞過Access的別名／預覽網址。Access的具體path優先順序須在staging實測。
7. webhook 若被轉到 Access 登入頁，LINE 驗證不會成功；不要因此拆掉所有後台保護。

## 4. 環境與秘密

在 `wrangler.jsonc` 各環境 vars 設 `APP_ENV`、`PUBLIC_ORIGIN`、`ADMIN_EMAILS`（JSON字串陣列）。不要放 channel secret、token到git或前端。

使用 Wrangler secret，各環境分別輸入：

```sh
pnpm exec wrangler secret put LINE_CHANNEL_SECRET --env staging
pnpm exec wrangler secret put LINE_CHANNEL_ACCESS_TOKEN --env staging
pnpm exec wrangler secret put LINE_DESTINATION_ID --env staging
pnpm exec wrangler secret put ACCESS_TEAM_DOMAIN --env staging
pnpm exec wrangler secret put ACCESS_AUD --env staging
pnpm exec wrangler secret put PRIVACY_NOTICE --env staging
```

`ACCESS_TEAM_DOMAIN` 形如 `https://company-team.cloudflareaccess.com`；`ACCESS_AUD` 為此Access application的AUD，不是LINE Channel ID。`LINE_DESTINATION_ID` 是該bot的user ID，並非`@064lhzfu`或channel ID。使用LINE官方API／控制台確認測試與正式目的身分，不能照用本機的全零假值。

production 用不同值，重複上述命令的 `--env production`。`LOCAL_DEV_TOKEN`、`CLOCK`、`LINE_FETCH` 不設於正式雲端；後兩個僅為程序內測試注入，不接受公網輸入。

此程式不自動讀 `.env.example`，那只列名稱；Wrangler 本機與雲端秘密的配置方式須遵照對應 CLI。不把 `.dev.vars` 放入交付包。

## 5. 資料庫初始化與測試部署

使用設定好的實際 staging DB 名稱：

```sh
pnpm exec wrangler d1 migrations apply xinghong-booking-staging --remote --env staging
pnpm deploy:staging
```

0001 建表、index、交易trigger；0002 只做 `INSERT OR IGNORE` 預設排程與罐頭。不以 seed 覆寫同仁已發布的版本。migration 不能在既有正式DB手動刪表重跑。

先保持 `LAUNCH_APPROVED=false`，LINE空事件驗證可通過，真正預約事件暫停。確認權限、DB、Queue、Access、目的帳號與個資告知後，**只在測試環境** 改為true，部署測試版。

在測試OA開啟 Messaging API、Webhook，URL指到 `https://<staging-host>/webhooks/line`，啟用redelivery，實測既有OA人工聊天是否仍符合操作需求。不要在尚未測試前更動正式@064lhzfu。

## 6. Staging 必測項目

- 真手機完整走完三職缺及南投分流；每個場次顯示具體日期、時間與正確地點。
- LINE 原歡迎訊息不重複；未讀訊息不要為了測試去點開。使用新建測試對話。
- 13:00截止14:00場，跨午夜、週末、14天最後一天、停辦日期。
- 一般5+行政5，兩個手機同搶最後名額，一人重複按確認、網路中斷重送。
- 人工接手後原LINE聊天不被bot插話；恢復只接受後台明確操作。
- 實際Access登入、登出、撤權、過期JWT、非白名單、繞過網址、CSRF。
- Queue延遲、失敗重試、DLQ、回覆token失效；異常事件可由同仁辨認並改人工。
- 遠端D1實際交易與備份還原；無資料庫錯誤、名額超賣、舊資料丟失。
- 實際1000筆XLSX的CPU／記憶體／免費額度與中文Excel開啟。若超限，先縮小輸出／優化，不逕自升級付費。
- 所有核定罐頭逐項實測；`weather_notice` 用於選日期提示，成功確認中的停辦文字另外由 `booking_success` 管理。
- 個資刪除流程：每小時最多30筆預約清理、短期資料清理、備份及已下載Excel另管；人工模式長期識別保存的例外需書面決定。

## 7. 備份與回復

在公司受控、加密、非公開的位置備份；不是把SQL檔放在前端 `public/` 或寄給聊天AI。

```sh
pnpm exec wrangler d1 export xinghong-booking-production --remote --env production --output <approved-private-backup-path.sql>
```

尖括號是需要替換的參數，不能直接執行。復原先使用獨立的隔離測試DB，依當時官方D1支援的匯入／Time Travel方式操作，驗證booking、booking_events、容量、人工模式、settings版本與外鍵。不能先清空正式DB再研究怎麼還原。

若恢復到含已逾期個資的備份，重新套用清理政策再放行；若備份比目前預約舊，必須人工對帳期間新增／改期資料，不能只回復程式而假裝資料沒有差異。

程式回退採先暫停自動入口、保留最新DB、恢復已驗證相容Worker版本、確認資料schema相容，再決定是否恢復。不要把舊H1原型當成正式資料庫備援。

## 8. 正式放行

公司負責人填妥上線檢查表、獨立安全審查、真機測試、還原測試與費用確認。`scripts/preflight.mjs` 只要求證據編號存在，無法判斷報告真假，不是安全認證。

先用原設定 `LAUNCH_APPROVED=false` 部署正式資源、migrations、Access、Queue並檢查權限。要使用 package 的 production deploy 指令，需提供以下環境變數作為稽核線索：

```text
LAUNCH_APPROVAL_REFERENCE
SECURITY_REVIEW_REFERENCE
LINE_DEVICE_TEST_REFERENCE
BACKUP_RESTORE_REFERENCE
```

正式切換窗口由公司指定。準備人工作業備案、核對舊人工約不移轉也不保留名額之決定、現行OA重複回覆設定、LINE Channel對應及網址。經核准才設 `LAUNCH_APPROVED=true`；資料保存規範核准與清理測試通過後設 `RETENTION_ENABLED=true`。兩者是獨立開關。

每小時 UTC 分鐘17 的 Cron 只做資料保留清理，不是面試提醒。保留清理關閉時，要有人工按時清理排程；不可因忘記開啟而無限保存資料。

`pnpm deploy:production` 才會真正部署；本次交付沒有執行它。
