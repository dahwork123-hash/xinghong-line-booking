import ExcelJS from "exceljs";
import { jobLabel, officeLabel, AppError } from "./domain.mjs";

export async function exportBookings(rows, filter, actor) {
  if (rows.length > 1000) throw new AppError("EXPORT_TOO_LARGE", 413);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Xinghong booking";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("預約名單");
  const headers = [
    "預約編號",
    "姓名",
    "電話",
    "應徵職務",
    "應徵縣市",
    "面試分公司",
    "面試日期",
    "面試時間",
    "面試分組",
    "預約狀態",
    "加入來源",
    "面試主管",
    "建立時間",
    "最後異動時間",
    "最後操作人",
  ];
  sheet.addRow(headers);
  const fmt = (t) =>
    new Date((t + 28800) * 1000).toISOString().slice(0, 19).replace("T", " ");
  for (const b of rows) {
    const values = [
      b.id,
      b.name,
      b.phone,
      jobLabel(b.job_id),
      b.apply_city,
      officeLabel(b.office_id),
      b.local_date,
      b.local_time,
      b.pool === "admin" ? "行政" : "一般職缺",
      b.status === "confirmed" ? "已預約" : "已取消",
      b.source,
      b.snapshot.interviewer || "",
      fmt(b.created_at),
      fmt(b.checked_at),
      b.actor.startsWith("line:") ? "本人" : b.actor,
    ];
    const r = sheet.addRow(values.map((v) => String(v ?? "")));
    r.eachCell((cell) => {
      cell.numFmt = "@";
    });
  }
  sheet.columns.forEach((c, i) => {
    c.width = i === 0 ? 38 : [1, 2, 5].includes(i) ? 20 : 17;
  });
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "O1" };
  const meta = workbook.addWorksheet("匯出條件");
  meta.addRows([
    ["統計範圍", "新系統預約，不含未登錄的人工預約"],
    ["日期口徑", "面試日期"],
    ["符合筆數", String(rows.length)],
    ["匯出人", actor],
    ["條件", JSON.stringify(filter)],
    ["注意", "含個資，請依公司一年保存與匯出檔管理規則處理。"],
  ]);
  meta.columns = [{ width: 20 }, { width: 100 }];
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
