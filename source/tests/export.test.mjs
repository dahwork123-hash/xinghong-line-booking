import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { fixture, book, profile } from "./helpers.mjs";
import { exportBookings } from "../src/export.mjs";
test("real XLSX preserves phone text and does not turn user values into formulas", async (t) => {
  const f = await fixture(t);
  await book(f, await f.candidate(), undefined, {
    profile: { ...profile, name: '=HYPERLINK("https://evil.invalid")' },
  });
  const rows = await f.store.listBookings({}),
    bytes = await exportBookings(rows, { from: "2026-09-08" }, "staff");
  assert.equal(Buffer.from(bytes.subarray(0, 2)).toString(), "PK");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const sheet = wb.getWorksheet("預約名單");
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell("C2").value, "0900000001");
  assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.String);
  for (const s of wb.worksheets)
    s.eachRow((row) =>
      row.eachCell((c) => assert.notEqual(c.type, ExcelJS.ValueType.Formula)),
    );
  assert.equal(wb.getWorksheet("匯出條件").getCell("B3").value, "1");
});
