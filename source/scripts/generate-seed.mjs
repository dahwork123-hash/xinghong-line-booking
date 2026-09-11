import fs from "node:fs/promises";
import seed from "../seed.json" with { type: "json" };
const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
const values = {
  schedules: { current: seed.weeklySchedules, pending: null },
  templates: Object.fromEntries(
    seed.templates.map((t) => [t.key, { text: t.text, version: 1 }]),
  ),
};
const sql =
  "-- Generated from seed.json; initial install only. Do not rerun to overwrite published settings.\n" +
  Object.entries(values)
    .map(
      ([key, value]) =>
        `INSERT OR IGNORE INTO settings(key,value,updated_at,actor) VALUES(${quote(key)},${quote(JSON.stringify(value))},unixepoch(),'bootstrap');`,
    )
    .join("\n") +
  "\n";
await fs.writeFile(
  new URL("../migrations/0002_seed.sql", import.meta.url),
  sql,
  "utf8",
);
console.log("Generated migrations/0002_seed.sql");
