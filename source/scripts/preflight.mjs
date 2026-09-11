import fs from "node:fs/promises";
const required = [
  "LAUNCH_APPROVAL_REFERENCE",
  "SECURITY_REVIEW_REFERENCE",
  "LINE_DEVICE_TEST_REFERENCE",
  "BACKUP_RESTORE_REFERENCE",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    "Production deployment blocked. Missing review evidence: " +
      missing.join(", "),
  );
  process.exit(1);
}
const config = await fs.readFile(
  new URL("../wrangler.jsonc", import.meta.url),
  "utf8",
);
if (config.includes("REPLACE_WITH_PRODUCTION")) {
  console.error(
    "Production deployment blocked: configure company-owned database and hostname.",
  );
  process.exit(1);
}
console.log(
  "Evidence references present. This check is not an independent security audit. Review the deployment checklist before proceeding.",
);
