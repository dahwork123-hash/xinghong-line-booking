# 上線前安全審查說明

**狀態：有安全防護與自動測試的RC，仍待同事／公司獨立審查與真環境驗證。不是「安全無漏洞」聲明。**

## 威脅模型與已落實防護

| 風險 | 防護 | 審查位置 |
|---|---|---|
| 偽造 LINE webhook | 對原始UTF-8 bytes做HMAC-SHA256驗證，驗證目的bot | `security.mjs`, `line.mjs` |
| 偽造管理身分 | Access RS256公開金鑰JWT、issuer/aud/exp/iat/sub/email、白名單 | `security.mjs` |
| 偷用本機登入 | 必須local環境+loopback HTTP+隨機啟動代碼；正式不接受 | `security.mjs`, `dev-server.mjs` |
| 跨站操作 | exact Origin、JSON、特定header，不開CORS | `security.mjs` |
| SQL注入 | prepared bind參數；filter欄名固定白名單 | `store.mjs` |
| XSS | 前端資料escape/textContent；外部JS/CSS配嚴格CSP；無富文字模板 | `public/app.js`, `security.mjs` |
| Excel公式注入 | 使用真正XLSX字串cell，不把輸入轉formula，不用偽裝副檔名CSV | `export.mjs` |
| 超賣與同人重複約 | DB trigger在同一寫入交易檢查，持久化身分鎖及版本 | `0001_initial.sql`, `store.mjs` |
| 重送、重複按鈕 | Webhook ID去重、操作冪等鍵、payload hash、按鈕身分/版本/效期綁定 | `line.mjs`, `store.mjs` |
| 人工接手競爭 | 同一身分租約，持久化mode及mode_revision，送出前再檢查 | `line.mjs`, `store.mjs` |
| 來源訊息外洩 | 入Queue前最小化欄位；不取媒體內容；不在console輸出body/電話/token | `line.mjs`, `worker.mjs` |
| 失敗誤報 | 回覆不確定記uncertain、不轉Push、不靠訊息送達決定交易是否成功 | `line.mjs` |
| 資源濫用 | body/事件大小、候選人/管理者rate limit、每週場次及匯出限制 | `security.mjs`, `domain.mjs` |
| 依賴變動 | 精確版本與pnpm lockfile；安裝預設ignore-scripts | `package.json`, `pnpm-lock.yaml` |

## 相依套件結果

2026-09-08第一次 `pnpm audit` 發現 ExcelJS 間接依賴 uuid 8.3.2 有1項moderate通報 GHSA-w5hq-g745-h8pq。查核ExcelJS只用該套件v4方法，但沒有以此忽略掃描結果。

已在 `pnpm-workspace.yaml` 限定 `exceljs>uuid: 11.1.1` 修補版本，重跑XLSX讀寫、Worker build、本機workerd匯出與完整audit。最後一次audit回報已知通報0；**這只表示當時套件資料庫未列出已知漏洞，不代表程式／基礎設施設計沒有風險。**

[uuid 維護者安全公告](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq)；上線當天需重新掃描。仍有ExcelJS間接套件的deprecation警告，不等於同一份漏洞公告，但需維護追蹤。Miniflare 5 alpha是固定的開發測試相依，不打入正式Worker；與此版本Wrangler配套，更新須一起驗證。

## 上線前阻擋事項

1. 遠端Cloudflare Access實際JWT、登入/登出/撤權、路由繞過、公司身分提供者與MFA設定，尚未驗證。
2. LINE真機、實際Reply時效、Queue延遲／redelivery、原LINE人工聊天相容性、實際帳號回覆設定，尚未驗證。
3. 遠端D1負載、Queues/DLQ、Worker CPU與免費額度、1000筆匯出耗時，尚未驗證；不可將本機快當成Free方案足夠的證明。
4. 遠端備份還原與切換窗口尚未執行；生產資料復原必須有專人對帳。
5. 核定個資告知、雲端委託、匯出檔保管、備份保留期限、刪除申請與停用人工狀態清理政策尚需公司確認。現RC長期保留的人工接手LINE身分狀態不能被當成已核准永久保存。
6. Queue及DLQ短期包含姓名／電話輸入及reply token；不公開、不交聊天AI，不把原始payload開到監控。DLQ有積壓須當日處理。
7. 大量偽造HTTP由簽章防止資料庫寫入，但仍消耗網路/CPU；需Cloudflare層rate limit/WAF/配額告警。有效LINE使用者濫用會消耗Queue操作量，須實測並訂處理策略。
8. 程式作者自測不取代第二位工程師審閱。簽核前不得以「production」資料夾名稱、綠色測試或已填證據編號宣稱正式安全。

## 必查事故邊界

- DB已提交但成功回覆失敗：以DB為準，原LINE人工查詢／回覆，不補建第二筆。
- 回覆送出但event完成狀態寫入失敗：下次可能使用舊reply token並得到失敗，名額仍不可重複扣；通知狀態不能保證exactly-once delivery。
- Queue亂序：早於已保存事件時間的事件忽略並留下out_of_order；使用者快速連發或同毫秒事件仍須真機測試。狀態機不是自由文字AI。
- 截止時間：伺服器計時，開始前一小時已截止；DB transaction使用此次伺服器檢查時間，不接受客戶端自報時間。需驗證遠端延遲對截止邊界的影響。
- 同仁改罐頭／排程：revision衝突需重新載入；不能直接覆蓋別人的新版本。
- 人工代約：同樣計名額並留下操作者，不提供繞過5人上限的入口。
- 程式關閉啟用：`LAUNCH_APPROVED=false` 不會刪除現有預約；已排隊事件可能重試進DLQ，需人工處理。

## 回報漏洞

將最小重現步驟、受影響原始碼位置、預期與實際行為、假資料測試、風險等級交公司維護人員。不要把真姓名電話、LINE token或完整DB備份貼入公開issue或AI對話。
