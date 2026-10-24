// 一次性迁移脚本：将库源码中的 console.* 替换为可关闭的 debugLogger。
// 仅处理"随包发布"的库文件，跳过 demo（App/DebugPanel/clearIndexedDB/useDebugLogger）与测试。
// 运行：node scripts/migrate-console-to-debug-logger.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";

const ROOT = resolve("src");

// 随包发布的库文件（相对 src 根）。不含 demo / 测试。
const targets = [
  "components/ZustandFileDownload/worker/downloader.worker.ts",
  "components/ZustandFileDownload/utils/storage.ts",
  "components/ZustandFileUpload/worker/uploadWorker.ts",
  "components/ZustandFileDownload/utils/downloader.ts",
  "components/ZustandFileDownload/hooks/useDownloadFiles.ts",
  "components/ZustandFileDownload/api.client.ts",
  "components/ZustandFileUpload/worker/filePrepareWorker.ts",
  "components/ZustandFileUpload/components/BatchInfoDisplay.tsx",
  "components/ZustandFileDownload/worker/merger.worker.ts",
  "components/ZustandFileDownload/store/index.ts",
  "components/ZustandFileDownload/hooks/useStorageManager.ts",
  "components/SimpleUploadList.tsx",
];

const REPLACEMENTS = [
  [/console\.error\(/g, "debugError("],
  [/console\.warn\(/g, "debugWarn("],
  [/console\.debug\(/g, "debugLog("],
  [/console\.log\(/g, "debugLog("],
];

for (const rel of targets) {
  const file = resolve(ROOT, rel);
  let code = readFileSync(file, "utf8");
  const original = code;

  // 跳过已迁移文件
  if (code.includes("debugLogger")) {
    console.log(`skip (already migrated): ${rel}`);
    continue;
  }

  for (const [re, rep] of REPLACEMENTS) {
    code = code.replace(re, rep);
  }

  // 统计实际用到的函数
  const used = [];
  if (code.includes("debugError(")) used.push("debugError");
  if (code.includes("debugWarn(")) used.push("debugWarn");
  if (code.includes("debugLog(")) used.push("debugLog");

  if (used.length === 0) {
    console.log(`skip (no console.* found): ${rel}`);
    continue;
  }

  // 计算相对导入路径
  const fromDir = dirname(file);
  const relPath = relative(fromDir, resolve(ROOT, "shared/debugLogger"));
  const importPath = "./" + relPath.replace(/\\/g, "/").replace(/\.ts$/, "");
  const importLine = `import { ${used.join(", ")} } from "${importPath}";`;

  // 在最后一个 import 语句之后插入
  const lines = code.split("\n");
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s/.test(lines[i])) lastImportIdx = i;
  }
  if (lastImportIdx === -1) {
    // 无 import，插到最前
    lines.unshift(importLine);
  } else {
    lines.splice(lastImportIdx + 1, 0, importLine);
  }
  code = lines.join("\n");

  if (code !== original) {
    writeFileSync(file, code, "utf8");
    console.log(`migrated: ${rel} -> ${used.join(", ")}`);
  }
}
console.log("done");
