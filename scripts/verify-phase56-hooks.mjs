import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const countEffectiveLines = (filePath) => {
  const content = readFileSync(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
};

const publicHookTargets = [
  "src/components/ZustandFileUpload/hooks/useBatchUploader.ts",
  "src/components/ZustandFileDownload/hooks/useFileDownloader.ts",
];

const controllerTargets = [
  "src/components/ZustandFileUpload/hooks/useBatchUploaderController.ts",
  "src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts",
];

const rows = [];

for (const relativePath of [...publicHookTargets, ...controllerTargets]) {
  const fullPath = join(root, relativePath);
  if (!existsSync(fullPath)) {
    rows.push({ path: relativePath, lines: -1 });
    continue;
  }

  rows.push({ path: relativePath, lines: countEffectiveLines(fullPath) });
}

const gateLimit = 400;
const gateFailures = rows
  .filter((row) => publicHookTargets.includes(row.path))
  .filter((row) => row.lines < 0 || row.lines > gateLimit);

console.log("Phase 5/6 Hook Line Metrics");
for (const row of rows) {
  console.log(`- ${row.path}: ${row.lines}`);
}

if (gateFailures.length > 0) {
  console.error("\nGate failed: public hooks exceed 400 lines.");
  process.exit(1);
}

console.log("\nGate passed: public hooks are within 400-line limit.");
