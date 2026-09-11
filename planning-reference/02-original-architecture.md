# 星鴻 LINE 面試預約：技術架構與資料設計

交接版 H1｜2026-09-07｜供同事及其 AI 建置，非已上線服務。

本文件補充 `01-requirements.md` 的工程細節。業務規則以 01 為準；以下明標的「實作建議」可以在不改變已核定行為、不新增費用的前提下調整。不得把原型 localStorage 搬上網就稱為正式後端。

## 1. 系統分工

```text
104／1111 的既有 LINE 入口
          ↓
LINE @064lhzfu 聊天室
使用者訊息／Quick Reply／Postback
          ↓ HTTPS
Webhook 接收層：原始 body 簽章驗證、來源檢查、事件去重
          ↓
對話狀態機 ── 人工接手狀態檢查 ── 核定罐頭版本
          ↓
共同預約服務：身分、職缺地區、截止、容量、取消、改期
          ↓ 原子操作
持久資料庫：預約、場次、異動、設定、人工狀態、發送結果
          ↓ 儲存成功後
LINE Reply API：當次即時確認；失敗不偷偷改用 Push

同仁瀏覽器 → 登入與授權 → 新預約管理後台 → 同一預約服務／資料庫
同仁人工聊天 → 原 LINE 官方帳號後台（不建新收件匣）
```

LINE 聊天與新後台共用業務服務，不能有兩套計數或兩套改期邏輯。原 LINE 的人工聊天不被假設為能完整同步到新資料庫。新後台的「完整紀錄」指上線後新預約與其異動，不是舊聊天備份或原 LINE 全量對話。

## 2. 建議技術選型

| 層次 | 首選評估方案 | 選擇原因／限制 |
|---|---|---|
| Webhook 與 API | TypeScript、Cloudflare Workers Free | 單一小型服務；先核對現行 SDK、執行限制及免費額度 |
| 持久資料 | Cloudflare D1 | 可使用關聯式約束及批次交易；不能用試算表或瀏覽器記憶體占名額 |
| 管理網頁 | 現有專案框架優先；沒有則小型 TypeScript 前端 | 不為首版另外引入大型 CRM、微服務或付費 UI 工具 |
| 管理者登入 | 公司既有 IdP／OIDC，或評估 Access 白名單 | 每人獨立身分、全部同權限；帳號及方案尚未取得，不承諾已可免費使用 |
| LINE 介面 | 聊天室文字 + Quick Reply／Postback | 不強制 LIFF；正式確認在聊天事件內完成 |
| 匯出 | 成熟 XLSX 程式庫 | 真正 .xlsx，電話保留文字；不能 CSV 改副檔名 |
| 開發／驗證 | 鎖定相依版本、單元測試、資料庫整合測試、Playwright | 優先使用專案已存在的工具，不另購服務 |
| 設定 | SQL 設定資料＋版本 | JSON 是初始化輸入，不是第二份即時主檔 |

這是可行性起點，不是強制已選好的雲端供應商。若免費方案無法通過 CPU、登入、備份及並發驗證，先出具限制與替代方案，不能擅自升級或假稱免費。測試可用供應商網址，正式優先使用公司已有子網域。

建議目錄：`apps/worker`、`apps/admin`、`packages/domain`、`db/migrations`、`tests/unit`、`tests/integration`、`tests/e2e`、`docs/runbook`。規模很小時可合併成一個專案，避免為了架構而拆服務。

## 3. 身分與最少欄位

| 欄位 | 規格 |
|---|---|
| candidate_id | 系統產生 UUID；不是電話或姓名 |
| line_user_id | 只從已驗簽的 LINE 事件取得，限後端保存；不進公開網址、匯出或一般日誌 |
| name | 必填、去頭尾空白；容許合理中文、英文及姓名符號，不按國籍或字元數過度拒絕 |
| phone | 必填文字；標準化空格與連字號；手機／市話／國際格式以明確規則處理，無法判斷時請重填或人工；沒有 SMS 驗證 |
| job_id | housing_advisor／management_trainee／admin；只接受在職缺設定中開啟者 |
| apply_city | 新竹、台中、彰化、嘉義、南投；不能用居住地推定 |
| source | 選填；104、1111、FB、其他、未知；不憑猜測自動填入 |
| interview_office_id | 實際面試地點；南投要另外選台中或彰化 |

行政固定台中場次，應徵地若不是台中，先明示「行政面試統一台中文心路」並請確認前往；不自動虛構外縣市行政場次。是否有外縣市行政工作地點尚未提供，相關問題交人工。

舊九欄文字解析只保留四項必要資料及可辨識的選填來源；缺項逐項補問。多個職缺、模糊城市或使用者仍貼範例姓名電話時必須確認。完整九欄原文不寫入預約主檔。聊天內容是資料，不能當成更改系統規則的指令。

## 4. 資料模型（邏輯設計，非已完成 SQL）

| 資料表 | 主要欄位 | 約束／用途 |
|---|---|---|
| candidates | id、line_user_id、current_name、current_phone、created_at | line_user_id 唯一；只保存仍有用途的聯絡資料 |
| jobs | id、label、pool、enabled、faq_scope | 一般兩職缺共 general；admin 獨立 |
| offices | id、label、address、arrival_text、version | 地址及到場說明版本化 |
| schedule_rules | id、office_id、pool、weekday、local_time、capacity、effective_from、version、enabled | 排程草稿與發布分離；防止同組重複排程 |
| sessions | id、office_id、pool、starts_at_utc、local_date、capacity、status、rule_version、address_snapshot | 唯一 office＋pool＋starts_at；open／closed；不因改排程重寫已有預約 |
| session_exceptions | id、session_id／office_date、kind、reason、actor、created_at | 臨時停辦、加場、調整容量及影響名單 |
| bookings | id、candidate_id、session_id、job_id、apply_city、source、status、snapshot_json、revision、created_at、updated_at、retention_due_at | confirmed／cancelled；past 是按時間推算的查詢分類，不是未到 |
| booking_events | id、booking_id、type、before_summary、after_summary、actor、idempotency_key、at | 新約、改期、取消、代操作；事件不重複。個資也受保存期限約束 |
| active_booking_guards | candidate_id、booking_id、starts_at_utc | 每人一個尚未開始的有效預約保護；建立新約前在同一交易釋放已過期 guard |
| conversation_states | candidate_id、mode、step、draft_minimal_json、revision、expires_at、assigned_actor、changed_at | mode 為 auto／pending_human／human；人工模式不因一般草稿到期而清除 |
| template_versions | key、scope、version、content、status、published_by、published_at | draft／published；發布前驗變數，成功訊息使用預約快照 |
| webhook_events | channel_id、event_id、event_time、type、processing_status、lease_until、result_ref、expires_at | 唯一 channel＋event；接收、處理完成、可重試失敗要區分 |
| delivery_attempts | id、booking_id、event_id、reply_status、error_code、attempted_at | 預約是否成立與訊息有無送達分開；不保存可重放的 reply token |
| admin_users | id、identity_subject、email、enabled、last_login_at | 每人獨立白名單；所有啟用同仁同等功能 |
| audit_events | id、actor_id、action、entity_id、redacted_diff、at、request_id | 罐頭、容量、停辦、人工接手、匯出與登入異動 |

索引至少涵蓋：sessions(local_date, office_id, pool)、bookings(session_id, status)、bookings(candidate_id, status)、bookings(retention_due_at)、conversation_states(mode)、事件唯一鍵。姓名電話搜尋需設計索引或限制查詢，避免每次全表掃描耗盡免費讀取額度。

快照至少含姓名、電話、應徵地、職務、面試地址、日期時間、到場說明、行政主管及模板版本。地址顯示須帶地標：彰化「國泰銀行樓上」、嘉義「旅遊家左邊樓梯上樓」；05 的 landmark 若存在，合併到確認訊息的 address 顯示值。快照用於追查「當時確認了什麼」；保留不代表個資可永久保存。個資清除應同步涵蓋快照、事件與備註。

## 5. 場次與時間演算法

1. 所有伺服器時間由可信時鐘取得，儲存 UTC；顯示與曆日生成一律 Asia/Taipei。
2. 實作口徑：含今天共 14 個台灣曆日，即 today 至 today＋13，非往後 336 小時滑動視窗。
3. 依職缺映射 general／admin，依面試地點找到排程；南投不產生另一套場次。
4. 生成具體日期時間，再套停辦、加場、生效版本。場次唯一鍵避免重複生成。
5. 可約條件：在 14 天內、排程有效、場次開啟、`now < starts_at - 60 minutes`、該組尚有名額。
6. 14:00 場 12:59:59 可約，13:00:00 起不可新約。正式版以伺服器收到且處理確認操作時的檢查為準，使用者手機時間不算。
7. 列表不是占位；最後確認重新檢查全部條件。日期超出範圍、按鈕過期或滿額請重選，不猜另一場。
8. 取消條件：`now < starts_at`，開始瞬間及之後不可自助取消；改期的新場次仍遵守一小時截止。原約已開始後，不提供自助修改過去預約。

目前沒有優先保留名額、候補或人工超額通道。後台內的人工代約和求職者自助預約走同一容量規則。

## 6. 原子占額與一人一約

以下是不變條件，不是可以直接貼到正式資料庫的 SQL：

- 同一 office＋datetime＋pool 的 confirmed 計數不得因新約超過 capacity；降低容量可以造成既有數大於新容量，但不得刪人或再收新約。
- 每個 candidate 在同一瞬間最多一筆 starts_at 大於目前時間的 confirmed 預約。
- 同一業務操作重送只建立一次；相同冪等鍵但不同 payload 必須拒絕。
- 事件、預約、占額與異動歷程要一致，不能其中一半成功。

建議以資料庫內條件式寫入、唯一約束／觸發器與交易實作；對「條件不符而更新 0 列」明確處理，不能視為成功再寫入下一筆。Cloudflare D1 的 `batch()` 提供順序執行與失敗回滾，但應用端在 batch 外「先 SELECT 數人數，再無條件 INSERT」仍然不安全。必須讓名額與唯一身分條件在資料庫寫入當下成立，並以真實 D1 整合測試證明。[D1 batch 官方說明](https://developers.cloudflare.com/d1/worker-api/d1-database/)

不可用 `UNIQUE(candidate_id, status)` 永久限制 confirmed：過去已面試的預約可以保留，該人仍可再約未來場次。可採 active guard 或等價設計；釋放舊 guard 和建立新 guard 必須與新約同交易，不依賴每日排程剛好有執行。

新增流程：驗證身分與 payload → 檢查人工模式 → 讀取／驗證操作版本 → 在同一原子操作核對截止、停辦、容量、一人一約及冪等 → 建立預約與事件 → commit → 嘗試 Reply → 記錄發送結果。

改期流程：核對擁有權與 revision → 新場重新驗容量及截止 → 同一交易轉移占額、更新預約快照、增加改期事件 → commit。任何一步失敗，原 session_id、原名額及舊快照不變。不先取消再重新新增。

取消流程：核對擁有權、開始前、再次確認的操作識別 → 原子更新 confirmed 至 cancelled、釋放 guard／占額、增加事件。重複取消返回原結果，不重複扣減。

## 7. Webhook 與可靠回覆

| 情況 | 必須的行為 |
|---|---|
| 簽章錯誤／缺失 | 不解析執行業務、不寫預約；用原始 body 驗 HMAC，不重新 JSON 序列化後驗 |
| 沒有事件的驗證請求 | 合法請求回應成功，不製造候選人或預約 |
| 相同 webhookEventId 重送 | 查處理結果；完成則不重建，處理中／失敗依可恢復狀態處理，不能只插去重鍵就永遠吞掉 |
| 不同事件同樣確認 | 業務冪等與每人 guard 再防一次，不能只依 LINE 去重 |
| 舊卡片、偽造 session_id | 查伺服器允許的職缺、場次、身分、revision，過期請更新選單 |
| 資料庫失敗 | 不回成功；保留可追查的錯誤碼及人工處理入口 |
| 預約 commit 成功、Reply 失敗 | 預約仍成立，標記通知待處理；同仁回原 LINE 確認；使用者查「我的預約」可讀原結果 |
| Reply token 過期／已使用 | 遵守現行 LINE 限制；不無限重試、不自動改用計費 Push |
| 事件晚到／亂序 | 以狀態 revision 及目前預約為準；時間戳協助判斷，不讓舊訊息取消新約 |
| 圖片、貼圖、未知問題 | 不把媒體當姓名電話；回可用選單或按規則轉人工 |
| 加入好友／歡迎訊息 | 沿用原後台歡迎訊息，bot 不重複發送九欄或新歡迎文案 |

Webhook 不能只回 200 後把未持久工作丟到會結束的記憶體背景。若採非同步處理，先選擇具耐久性且通過費用審查的機制，定義重試與卡住工作恢復。首版規模小，優先保持流程簡單且在 Reply 時效內完成。[LINE Webhook 官方說明](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)

首版每個日期／時間按鈕數量需分頁；Quick Reply 上限 13 個，手機以外需有可讀文字入口。按鈕帶 opaque id，不帶可修改的完整個資。以「我要四點」等文字只能找到候選場次並再次確認，「只有四點嗎」不能直接成立預約。[Quick Reply 官方規格](https://developers.line.biz/en/docs/messaging-api/using-quick-reply/)

## 8. 對話與人工接手狀態機

預約狀態與對話模式分開，不能用「人工接手」覆蓋 confirmed 預約狀態。

```text
auto: 選職缺 → 選應徵地 → 南投選面試地 → 收姓名 → 收電話
      → 選填來源 → 日期 → 時段 → 核對 → 確認成功
任何階段 → FAQ（回答後仍保留原步驟）
任何階段 → 要求人工／未知問題 → pending_human
pending_human → 同仁按「人工接手」 → human
auto → 同仁主動按「人工接手」 → human
human／pending_human → 同仁按「恢復自動」 → auto
```

「人工接手」完成標準是狀態已持久寫入、後端查得到，才提示同仁回原 LINE。發送自動回覆前再核對最新模式，降低已進佇列回覆與人工接手的競爭；已發出的訊息無法倒退撤銷，必須在測試中記錄此邊界。人工狀態不因重載、換電腦、收到下一則訊息或草稿逾時自動解除。

實作建議：pending_human／human 期間所有自助異動交人工，舊確認按鈕也不可偷偷成立新約。後台可查既有預約；若提供求職者唯讀查詢，不能因此恢復自動聊天。本案原型採「暫停自助操作，交同仁處理」展示此邊界。此細節是保守實作口徑，不新增自動解除規則。

清單只顯示必要識別資料、最後預約、原因、模式、接手人及時間；有「開啟原 LINE 後台」一般連結即可。未驗證前不要承諾可深連到特定求職者的原生聊天室。原 LINE 聊天內容由同仁自行查找，本次與後續測試禁止點開未讀訊息。

## 9. 管理後台詳細功能

| 頁面 | 主要控制 | 成功／空白／失敗處理 |
|---|---|---|
| 場次總覽 | 面試日期區間、面試地、分組；已約／容量／剩餘；點進名單 | 無場次顯示無符合場次；所有人數加註不含未登錄人工預約 |
| 預約查詢 | 日期、職缺、應徵地、面試地、狀態、姓名／電話／編號 | 分頁且條件保留；載入失敗不能顯示成 0 人 |
| 明細 | 確認快照、異動歷程、必要備註、改期／取消／人工接手 | 版本衝突請重新載入；不提供報到、未到或到場率 |
| 同仁代約 | 從已有 LINE 身分選人，沿用四項資料，選有效場次 | 同樣檢查 5 人與一人一約；不能以任意電話偽造 LINE 身分 |
| 時段設定 | 地點與分組、星期時間、容量、生效日、草稿、影響預覽、發布 | 不自動改已有預約；顯示確切受影響場次與名單 |
| 單次停辦／加場 | 具體日期與分組、原因、確認 | 關閉後不再新約；保留既有預約及待人工通知清單 |
| 罐頭管理 | 分類、適用範圍、變數、草稿、預覽、發布、版本 | 草稿不影響線上；未知變數或必要欄位缺失阻擋發布 |
| 人工清單 | 待人工、接手人、人工接手／恢復自動 | 不放新的聊天輸入框，不把按接手當成已聯絡 |
| 匯出 | 目前篩選結果 .xlsx | 含完整符合資料非僅當前分頁，下載前說明含個資及統計範圍 |

同仁代約若改期／取消成功，系統記下 operator，不自動用候選人的不存在 Reply token 發 LINE。由同仁回原 LINE 通知。每位同仁同權限，但需個別登入以保留責任。

## 10. 統計與 XLSX 合約

統計日預設用面試日期；有效預約是狀態 confirmed，歷史已過日期亦可列為歷史預約，不宣稱已出席。未來有效約的「尚未開始」只用於每人 guard。取消不占名額，改期只歸新場，原場只保留事件。

彙總粒度為面試地＋具體時點＋general/admin。總覽→分組→名單→匯出同一 filter contract，不能 general 分開各職缺再各套 5。新增日另標「建立日期」，不可混到面試日報表。

建議 XLSX 欄位順序：預約編號、姓名、電話、應徵職務、應徵縣市、面試分公司、面試日期、面試時間、面試分組、預約狀態、加入來源、面試主管、建立時間、最後異動時間、最後操作人。欄位核定前以此最小清單實作，不另輸出原九欄或 LINE userId。

第一張工作表為名單，第二張可為匯出條件與統計說明。電話儲存文字；含 `= + - @` 等使用者輸入必須作字串儲存，不成公式。匯出數量需等於所有分頁的符合筆數，不能只取前 100 筆；無符合資料仍能產出清楚空表。

## 11. 設定發布與既有預約

週期排程與單一場次分開。修改每週時段先預覽與生效日期，發布影響後續可選場次，不默默搬動已約的人。既有已約場次若不再對新約開放，可標關閉招生而保留既有安排；真正取消辦理需另外執行停辦操作並列待人工通知。

降低容量：已約 4 人改成 3，4 人全部保留、剩餘為 0、停止新約，警告已有數超出新容量；不能自動刪第 4 人。提高容量也需留操作者與版本。預設各組 5 是已核定起始設定，不是禁止授權同仁日後明確調整。

罐頭正文可維護，預約 ID、日期時間、地點等關鍵變數不可刪除到造成資訊不完整。版本發布只影響日後回覆，不改當時已送文字與預約快照。原 LINE 既有預設訊息不承諾同步，必要時同仁自行複製更新；歡迎訊息未獲核准不改。

## 12. 安全、個資與保存

這是工程治理清單，不是法律意見。用途告知內容與適法性由公司確認。保存 1 年是使用者選定的產品規則，不宣稱法定期限。

- 只接受 HTTPS；所有 admin API 驗登入與白名單，不只隱藏前端按鈕。若使用 Access/OIDC，驗 JWT 簽章、issuer、audience、expiry，不直接信任客戶端 email header。
- Secrets 僅由本人在雲端秘密管理介面／本機安全環境輸入；不進 Git、PPT、JSON、瀏覽器或給 AI 的文字。測試與正式 token／DB 分離。
- Session cookie 需 Secure、HttpOnly、合適 SameSite；依認證方式落實 CSRF、防 XSS、輸入長度限制、參數化 SQL、同源政策及節流。
- 敏感回應不 CDN 公開快取；分享出去的 ZIP 不含真實求職者、履歷、聊天、token、密碼或登入工作階段。
- 保存期按面試日加一個曆年；改期採最後確認日期，取消採原定日期。閏年 2/29 到期日建議落次年 2/28，明列測試。
- 到期先 dry-run 列範圍，依核定機制清除該筆可識別資料、快照、備註和關聯事件的個資；不刪同一人較新的預約。不需為「完整歷程」永久保留姓名電話。
- 未完成草稿、去重事件及技術日誌採最短必要 TTL，具體天數為待技術設計核定項目；人工 mode 的保存不被草稿 TTL 意外清除。
- 備份與下載 XLSX 也有到期處理責任；備份復原後須重套刪除清單，避免個資復活。各種備份保留上限、存放位置與負責人於上線前確認。
- 個資聯絡窗口、告知文字及公司資料保管人仍需提供；可先做無真實資料測試，不因欠此資料擅自真實上線。

## 13. 端點合約建議

候選人首版透過 LINE 事件使用服務，不需要公開允許以 userId 查他人預約的 REST API。下列管理端點全須登入。

| 方法／路徑 | 功能 | 關鍵控制 |
|---|---|---|
| POST /webhooks/line | 接收 LINE 事件 | 原始 body 驗簽、去重、事件模式檢查 |
| GET /api/admin/sessions | 篩選場次與容量 | 用面試日期，回傳統計口徑 |
| GET /api/admin/bookings | 篩選／分頁／搜尋 | 對應匯出同一 filter |
| GET /api/admin/bookings/:id | 明細與異動 | 授權，不公開個資 |
| POST /api/admin/bookings | 對已有身分代約 | idempotency-key、有效場次、容量、operator |
| POST /api/admin/bookings/:id/reschedule | 改期 | revision、原子轉移、截止 |
| POST /api/admin/bookings/:id/cancel | 取消 | 二次確認、revision、開始前 |
| POST /api/admin/candidates/:id/handoff | 接手 | mode、operator、持久保存 |
| POST /api/admin/candidates/:id/resume | 恢復自動 | 明確操作，不自動逾時 |
| POST /api/admin/schedules/preview | 草稿影響預覽 | 生效日與確切受影響場次 |
| POST /api/admin/schedules/publish | 發布 | revision、稽核、不動既有快照 |
| POST /api/admin/sessions/:id/close | 停辦 | 原因、影響名單、待人工通知 |
| POST /api/admin/templates/:key/publish | 罐頭發布 | 適用範圍、必要變數、版本 |
| GET /api/admin/export.xlsx | 真正試算表下載 | 同篩選、字串安全、匯出稽核 |

錯誤碼統一：UNAUTHORIZED、INVALID_INPUT、AMBIGUOUS_INPUT、NO_SLOT、SLOT_FULL、CUTOFF_PASSED、SESSION_CLOSED、ACTIVE_BOOKING_EXISTS、STALE_REVISION、HUMAN_HANDOFF、PERSISTENCE_FAILED。LINE 端轉親切繁體中文，不顯示 SQL、token 或內部 stack trace。

## 14. 建置階段與停止條件

| 階段 | 產出 | 進入下一階段的門檻 |
|---|---|---|
| A 接手與設計 | 讀取清單、差異清單、技術 ADR、待補資料、費用假設 | 不再重問已核定規則，先保留人工／5 人邊界 |
| B 核心服務 | migrations、rule engine、交易與冪等測試 | 真實資料庫最後一名競爭、改期失敗回滾通過 |
| C 管理後台 | 登入、全區查詢、設定、人工模式、XLSX | 多人共享狀態、授權及篩選一致通過 |
| D 專用測試 LINE | 真實手機互動、Reply、簽章、人工共存 | 不重複歡迎、不插話、不用真實求職者測試 |
| E 正式切換 | 備份還原演練、容量／費用報告、操作手冊、回退方案 | 指定公司負責人書面核准才改正式 Webhook |
| F 維護 | 問題清單、日誌／額度查核、定期還原與保存清理 | 不新增提醒、付費服務或業務規則除非另核准 |

這些階段沒有預先承諾工期。取得帳號、DNS、測試裝置和核准可能影響時程，AI 應在讀完現有程式與工具後估工，不憑本簡報聲稱一天即可正式上線。

## 15. 回退與維護手冊要點

正式切換前保存原 LINE 設定截圖／文字、舊 webhook 狀態及新服務版本。遇到錯誤時停止新的自助寫入，回人工安排；資料庫中已成立預約保留並供同仁查詢，不能刪除重建。

回退優先使用後端全域維護開關停止新寫入並提供可用人工入口；關閉或恢復 webhook 設定須由授權者依切換紀錄處理，不自動批次修改 OA。若資料庫不可用，不假顯示 0 人或預約成功。人工在原 LINE 告知確認情況。

每日營運：檢查待人工清單、通知失敗、關閉場次受影響者及服務錯誤；同仁仍在原 LINE 回覆。技術維護另檢查額度、登入撤權、備份與還原、到期個資處理。不安排自動面試提醒。

## 16. 官方參考與費用查核

查核日 2026-09-07。價格與免費額度可能改變，上線前再查；不把「每日僅 10～20 人」當成必然免費的證明。

| 事實／界線 | 官方來源 |
|---|---|
| LINE Reply 不計月訊息量，Push 類型另計；token 的使用限制仍需遵守 | [Messaging API 計費](https://developers.line.biz/en/docs/messaging-api/pricing/) |
| 台灣輕用量月費 0，含 200 則計量訊息；中／高方案已有 2026-11-01 調價公告，首版不預設升級 | [台灣 LINE 公告](https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/) |
| Workers Free 100,000 requests／日；付費起價 US$5／月，另可能有超量 | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| D1 Free 每日 500 萬列讀取、10 萬列寫入、總容量 5 GB；免費超額可能失敗 | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |
| workers.dev 不建議承載業務關鍵正式服務，需評估既有網域 | [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) |
| ChatGPT 訂閱與 API 帳務分開；不挪用訂閱登入當 bot API | [OpenAI 計費說明](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform) |
| Claude 付費訂閱不包含 API／Console 用量 | [Claude 官方說明](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-do-i-have-to-pay-separately-to-use-the-claude-api-and-console) |

上述建議不包含代建人力、備份儲存、可選網域年費、現有 AI 訂閱或日後加購。任何新增費用先列明項目、預估、上限及停止方式，未獲核准不購買。
