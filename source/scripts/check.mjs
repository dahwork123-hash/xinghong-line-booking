import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
async function walk(dir) {
  let files = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (
      [
        "node_modules",
        ".local",
        ".build",
        ".wrangler",
        "test-results",
      ].includes(e.name)
    )
      continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}
for (const file of await walk(root)) {
  if (!/\.(mjs|js)$/.test(file)) continue;
  const r = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.error);
    process.exit(1);
  }
}
console.log("JavaScript syntax checks passed.");
