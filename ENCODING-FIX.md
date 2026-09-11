# 跨平台檔名編碼修正

2026-09-08

截圖的invalid encoding出現在Linux/Thunar顯示的解壓檔名；不代表文件正文一定毀損。原H1 ZIP中央目錄抽查4筆，UTF-8旗標bit11已設定、原始檔名字節可正確解碼。因此目前無法證實「壓縮標頭壞掉」；可能與接收端解壓流程／工具的檔名轉碼有關。

本次直接將ZIP名稱、最上層目錄及所有內部路徑改成ASCII英數，文件正文維持UTF-8繁體中文；不用猜Big5/CP950或逐檔手動改名。原H1檔案保留不覆蓋。

文件HTML/Markdown/JSON中的已知檔名與連結一併改成新名稱，SHA-256重新計算。PPTX內部OOXML路徑原本為ASCII，保留二進位内容與投影片；畫面上的歷史中文標籤請查planning-reference/FILE-NAME-MAP.md。

接收者請直接解壓新ZIP，不要再用舊的亂碼解壓目錄覆蓋它。建議解壓目的資料夾也採英文。中文內容請以UTF-8開啟。

已以JSZip CRC/SHA-256往返驗證與ASCII路徑檢查；Windows原生解壓另行驗證。未在收件人的Linux/Thunar實機重測，不宣稱已修好其工具設定。
