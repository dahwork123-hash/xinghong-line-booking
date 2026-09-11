# 詳細實作架構與既定規則

## 系統邊界

```text
104 / 1111 職缺中的 LINE 加入連結
              |
              v
原 LINE 官方帳號 @064lhzfu（既有歡迎訊息保留）
              |
使用者輸入「預約面試」或按已收到的 Quick Reply
              |
LINE -> HTTPS POST /webhooks/line
              |
raw-body HMAC 驗簽 + destination + payload limits
              |
Cloudflare Queue（每個事件一訊息，consumer batch size = 1）
              |
狀態機 + LINE 身分鎖 + Webhook 去重 + DB transaction
              |                         |
              v                         v
Cloudflare D1                     LINE Reply API
              ^                   不呼叫 Push API
              |
員工瀏覽器 -> Cloudflare Access -> /api/admin/*
              |
原 LINE 後台人工聊天（人工接手期間停止自動回覆）
```

伺服器記錄才是唯一真實資料來源。瀏覽器不以 localStorage 保存預約；sessionStorage 只保存本機測試代碼。正式權限不看前端按鈕是否隱藏，也不信任使用者傳來的電子郵件欄位。

## 已確認營運規則

| 項目 | 定案 |
|---|---|
| 必填 | 姓名、電話、應徵職務、應徵縣市；加入來源選填 |
| 不再收 | 性別、年齡、居住地、前份工作 |
| 職缺 | 社宅顧問、儲備主管、行政職；全部直接預約 |
| 日期口徑 | Asia/Taipei，含今天共14個日曆日，即 today 至 today+13 |
| 新約與改期 | 場次提前1小時截止；14:00 場在13:00已關閉 |
| 取消 | 原場次開始前允許取消；開始當下與之後不可取消 |
| 一人一約 | 同一 LINE 身分最多一筆尚未開始的有效預約；過去預約不阻擋新約 |
| 容量 | 同一面試點、日期時間，一般兩職缺合計5人；行政另5人 |
| 人工超額 | 未登錄的人工預約與現場來訪可讓現場超過5人；不占新系統名額 |
| 後台代約 | 寫入新系統就受5人限制，沒有強制超額按鈕 |
| 統計標示 | 新系統預約，不含未登錄的人工預約 |
| 權限 | 每位授權同仁都能查全區、修改、發布、匯出；個別帳號保留操作身分 |
| 人工接手 | 按人工接手 -> 原LINE聊天 -> 明確按恢復自動；不自動逾時恢復 |
| 停辦 | 同仁關閉場次、取得受影響名單、原LINE人工通知 |
| 保存 | 面試日期後1個曆年；取消用原日期，改期用最後確認日期 |
| 首版不做 | 舊資料移轉、提醒、報到／未到、候補、自動審核、付費AI |

台中週三14:00可同時有一般5人及行政5人。南投不是獨立容量池，選哪個面試分公司就使用該分公司一般名額。

## 場次初始值

| 面試地／分組 | 星期與時間 | 地點 |
|---|---|---|
| 台中／一般 | 一11/14；二11/14/16；三10/14/16；四11/14/16；五14/16 | 台中市北屯區文心路四段698號6樓之1 |
| 台中／行政 | 三14:00，主管 TOBY | 同上 |
| 彰化／一般 | 四14:00 | 彰化市華山路37號11樓之4，國泰銀行樓上 |
| 嘉義／一般 | 三16:00、四16:00 | 嘉義市西區上海路175號2樓，旅遊家左邊樓梯 |
| 新竹／一般 | 二14:00、四14:00 | 新竹縣竹北市光明五街342號2樓 |

台中採用使用者後來確認的「目前後台」版本，不採最早貼出的舊時間。地址與上樓指引在 `seed.json`；首版畫面沒有地址編輯器，變更地址需受控程式／資料移轉，既有預約快照不能直接覆寫。

## 求職者操作

1. 加入 LINE，歡迎訊息由現行原後台發出；部署人員確認沒有其他關鍵字規則重複回應「預約面試」。
2. 選職務、應徵縣市。行政統一確認可到台中；南投一般職選台中或彰化，其餘依應徵地。
3. 在輸入姓名前顯示公司核定個資告知，填姓名、電話與選填來源。範例姓名、範例電話不可當成資料。
4. 選具體日期與時間。日期／時間 Quick Reply 會分頁，不使用容易混淆的單一「星期四」。
5. 最後確認重新在資料庫交易內檢查名額、截止、唯一預約與人工模式。成功才回傳預約編號、日期時間、地址、上樓方式、行政主管。
6. 「我的預約」查詢、修改、取消。改期不是先刪舊約：同一筆 booking 更新成功才換場。
7. 一般 FAQ 僅用核定罐頭；未選職務的薪資／工作問題、行政FAQ、無法辨識文字或媒體轉人工，不臆測薪資待遇。

沿用舊九欄文字仍能擷取四個必要欄位；不保存不需要的性別、年齡等欄位。職缺不明、同時寫多職缺時要求重選，不能因居住縣市判斷面試地。

## 狀態與交易

`conversations.mode`: `auto`、`pending_human`、`human`。模式與30分鐘按鈕／24小時草稿效期分離；草稿到期不能重啟機器人。未知問題先寫入待人工狀態，再回一次人工說明與協助編號。

`step`: home -> job -> city -> office/admin-office（必要時）-> name -> phone -> source -> date -> time -> review -> booking。FAQ、取消確認與改期是旁支，不能繞過最後交易檢查。

每個按鈕是隨機 token，資料庫綁定 candidate、對話 revision、動作、效期。Postback 不信任客戶端自報名額／時間／人員。舊按鈕、他人 token 不會成立預約。

`mutateBooking()` 一次 D1 batch 包含：身分鎖租約檢查、操作冪等鍵、舊預約 revision 檢查、寫入、關聯操作記錄；DB triggers 在同一筆寫入交易內驗證容量與一人一約，並記錄前後快照。例外造成整批回滾。操作完成與訊息送達是不同狀態。

鎖是資料庫持久化90秒租約，適用同一身分的預約、LINE 狀態與人工接手；不是只放在 Worker 記憶體。跨人搶名額最終依 DB transaction/trigger，不依此鎖。

## 資料表

| 表 | 粒度／用途 | 保存方式 |
|---|---|---|
| candidates | 一個 LINE user ID 一身分；不公開給前端 | 無預約、長期未互動且非人工接手者清理 |
| conversations | 一身分一筆，模式、草稿、版本、最後事件時間 | 草稿24小時；人工模式獨立 |
| sessions | 面試點+分組+開始時間唯一 | 規則生成、停辦狀態與容量，不含姓名電話 |
| bookings | 一筆預約及當時地址／職務／電話快照 | 面試後1年 |
| booking_events | 一筆建立／修改／取消紀錄 | 隨 booking 級聯刪除 |
| operations | 操作者+冪等鍵唯一，payload hash | 隨 booking 刪除 |
| action_tokens | 隨機按鈕，身分/版本綁定 | 30分鐘 |
| webhook_events | LINE event ID 唯一，處理與回覆狀態 | 去重 metadata14天；回覆文字約24小時後清理 |
| settings | 每週排程、罐頭、草稿與版本 | 不覆蓋已成立預約的快照 |
| audit_events | 誰在何時修改、發布、匯出 | 約1年；不記錄匯出搜尋文字 |
| locks / rate_limits | 租約與每分鐘計數 | 到期清理 |

待人工／人工接手中、無預約且一年未互動的 LINE 識別狀態目前不自動刪除，避免默默恢復自動；需公司決定人工停用／刪除流程。這是上線前須處理的保存政策邊界，不是永久保存姓名電話的授權。Queue／DLQ 的短期訊息也包含必要輸入，需依平台保留期限管理。

## 管理 API 摘要

所有 `/api/admin/*` 均需有效 Access JWT+白名單。所有 POST 另需相同 Origin、JSON、`X-Requested-With: booking-admin`。不開 CORS。

| 方法與路徑 | 用途 |
|---|---|
| GET `/me` | 身分、環境、UI初始資料 |
| GET `/sessions`, `/available` | 場次含零預約、可選時間 |
| GET `/bookings`, `/bookings/:id` | 篩選、快照、異動歷史 |
| GET `/export.xlsx` | 篩選一致的 XLSX，上限1000筆，超過明確拒絕而非截斷 |
| POST `/bookings` | 代約，confirm=true+Idempotency-Key |
| POST `/bookings/:id/reschedule`, `/cancel` | revision、confirm=true、冪等鍵 |
| GET `/candidates?offset=0`, `/candidates/:id` | 人工接手清單，200筆分頁 |
| POST `/candidates/:id/handoff`, `/resume` | 人工狀態切換 |
| POST `/sessions`, `/sessions/:id` | 加場、容量、停辦及原因 |
| GET `/settings` | 草稿與發布版本 |
| POST `/schedules/preview`, `/draft`, `/publish` | 排程變更與受影響場次 |
| POST `/templates/:key/draft`, `/publish` | 罐頭驗證、草稿、發布 |
| GET `/audit`, `/retention` | 操作與回覆異常、清理預覽 |
| POST `/retention/purge` | 日期再次確認，分批最多30筆 |

查詢與匯出以「面試日期」為口徑，不是建立日期。清單與詳細資料只開放公司授權人員；沒有提供不需登入的公網名單網址。

## 操作限制與未完成驗證

- 每週排程合計最多40個時間點／分組，單日每組最多8個；目前預設每週19組場次，符合限制。這是此首版資源保護，不是人數改成不限。
- 一次只能有一個尚未生效的排程版本；既有預約保留，刪除時段只停止新約。人工關閉的場次不會被規則自動重開。
- 地址、核定個資告知與帳號授權屬受控設定；日期與罐頭可由UI發布。
- LINE Reply 超時只記 `uncertain`，不自行改用 Push；Queue 超過45秒未處理的新事件轉待人工，避免以過期互動默默建立預約。
- Queue/DLQ、Access、真手機 LINE、公司 DNS、遠端D1延遲、免費額度CPU與實際流量尚待 staging 驗證。下游故障時要回原LINE人工接手，不可把「已入佇列」說成已完成預約。

## 官方技術參考（2026-09-08查核）

- [LINE Webhook 驗簽](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
- [LINE Messaging API Reference](https://developers.line.biz/en/reference/messaging-api/)
- [D1 batch 交易 API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 限制](https://developers.cloudflare.com/d1/platform/limits/)
- [Queues 批次與重試](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Cloudflare Access JWT 驗證](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
