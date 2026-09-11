# 本次驗證結果

版本：0.1.0-rc.1。2026-09-08在 Windows／Node v24.19.0／pnpm 11.19.0 執行。**全部為假資料，本次沒有正式部署或LINE真機測試。**

| 驗證層 | 結果 | 證據 |
|---|---|---|
| JavaScript語法 | 通過 | `test-results/syntax.log` |
| Node單元／整合／並行／備份 | 40通過、0失敗 | `test-results/unit-integration.log` |
| Worker staging dry-run build | 通過，不上傳 | `test-results/worker-build.log` |
| Cloudflare本機workerd/D1 | 1項整合情境通過 | `test-results/cloudflare-local.log` |
| 瀏覽器桌機／390px手機 | 9項檢查通過、無JS錯誤 | `test-results/browser.json`及PNG |
| pnpm已知漏洞掃描 | 修補後0項通報 | `test-results/dependency-audit.log` |
| 完整執行結果 | 6個驗證階段通過 | `test-results/verification.json` |
| 正式LINE／遠端Access／遠端D1 | 未執行 | 需由公司staging完成 |
| 獨立安全稽核 | 未執行 | 交由接手同仁審查 |

## 自動測試涵蓋

- 台灣日期／午夜與閏年一年保存、最新台中時段、行政TOBY。
- 必填四欄、來源選填、保留電話開頭0、拒絕範例及不合法資料。
- 南投目的地與應徵地分離、一般共5人／行政獨立5人。
- 一人一筆未來有效預約、同操作冪等、不同內容同鍵拒絕。
- 同日可約、整點提前1小時截止、取消前後名額。
- 改期滿位失敗原約完整保留、樂觀版本衝突、開始後禁止自行異動。
- 獨立Worker thread與SQLite連線競爭最後名額、同LINE身分競爭不同場次。
- 人工模式跨草稿到期仍保留、自助停止、後台代約仍可在容量內成立。
- 關閉場次、下修容量不刪人、重新發布排程可恢復曾移除時段。
- 草稿／罐頭不同同仁版本衝突不會默默覆蓋。
- SQL注入輸入、無效日期、限流、body大小／JSON／UTF-8拒絕。
- LINE原始bytes簽章、wrong key、目的帳號、尚未啟用閘門。
- JWT簽章、issuer/audience、過期、必要claims、非白名單、偽造email header／本機token不通過正式登入。
- CSRF同Origin／JSON／應用header。
- 簽章通過後才入Queue，多事件分開；consumer完成確認、過久事件轉人工、失敗重試。
- 模擬LINE完整台中預約與取消、南投彰化預約、行政FAQ人工、未知問題人工、舊按鈕／跨人token、亂序與Reply timeout。
- 真XLSX可讀、電話字串、公式注入防護；本機備份還原保留人工模式、快照、異動與設定。
- 逾期booking級聯清除，不刪同一人較新預約。

## 本機Cloudflare與畫面驗證

Cloudflare測試使用這次build產生的Worker bundle及D1 binding，真的執行migration與trigger、滿額rollback、排程發布、未授權拒絕及XLSX下載，不只是Node語法檢查。這仍是本機模擬器，不證明遠端延遲／配額／Access／Queue外部傳送的實際行為。

Edge headless操作實際 `public/` 畫面與本機HTTP後端，檢查登入、場次、明細、人工作業狀態保存／恢復、排程草稿、罐頭預覽發布、Excel下載、手機不超出頁寬、手機彈窗及JS錯誤。截圖是**本次程式的假資料管理後台**，不是正式LINE聊天畫面。

## 本次修正紀錄

測試過程修正了本機啟動語法、無效日期、排程重啟、草稿版本衝突、按鈕分頁、管理API輸入白名單、SQL migration與Wrangler解析器相容、登入後殘留錯誤提示，以及匯出套件的uuid間接依賴漏洞。最後再執行完整verify後交付。

## 測試缺口

沒有宣稱完整程式碼覆蓋率、滲透測試、所有文字組合、全量壓力測試或零漏洞。真手機LINE、Access真人登入撤權、遠端D1／Queues/DLQ與備份還原、免費CPU/大量匯出容量與個資告知需按 RELEASE-CHECKLIST.md 驗證。macOS與接收端Linux/Thunar未實機重測；檔名改成ASCII並驗證ZIP結構及解壓，降低跨平台編碼依賴。

## 重跑

先安裝已鎖定相依與可用瀏覽器，再用 `pnpm verify`。它會產生最新 `test-results/`，任何一階段失敗就停止，不會把失敗標成通過。執行時只連npm漏洞資料庫；LINE外送是mock，Cloudflare採本機及dry-run，不部署遠端。
