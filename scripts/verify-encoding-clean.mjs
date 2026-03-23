import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["src", "docs", "server/src"];
const TARGET_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".md",
  ".json",
]);

const suspiciousTokens = [
  "鏂囦欢",
  "涓婁紶",
  "涓嬭浇",
  "璇锋眰",
  "鎴愬姛",
  "澶辫触",
  "杩涘害",
  "缃戠粶",
  "鍒嗙墖",
  "鍙傛暟",
  "寮€濮",
  "缁撴灉",
  "鎿嶄綔",
  "閰嶇疆",
  "鏄惁",
  "鍒楄〃",
  "娓呯┖",
];

const findLineColumn = (source, index) => {
  const prefix = source.slice(0, index);
  const lines = prefix.split("\n");
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
};

const shouldScan = (filePath) => TARGET_EXTENSIONS.has(path.extname(filePath));

const walkFiles = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walkFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && shouldScan(fullPath)) {
      result.push(fullPath);
    }
  }

  return result;
};

const findings = [];

for (const relativeDir of TARGET_DIRS) {
  const absDir = path.join(ROOT, relativeDir);
  try {
    const stats = await fs.stat(absDir);
    if (!stats.isDirectory()) {
      continue;
    }
  } catch {
    continue;
  }

  const files = await walkFiles(absDir);
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");

    const replacementCharIndex = source.indexOf("\uFFFD");
    if (replacementCharIndex >= 0) {
      const { line, column } = findLineColumn(source, replacementCharIndex);
      findings.push({
        file,
        line,
        column,
        reason: "Found Unicode replacement character (�).",
      });
    }

    for (const token of suspiciousTokens) {
      const tokenIndex = source.indexOf(token);
      if (tokenIndex < 0) {
        continue;
      }
      const { line, column } = findLineColumn(source, tokenIndex);
      findings.push({
        file,
        line,
        column,
        reason: `Found suspicious mojibake token "${token}".`,
      });
    }
  }
}

if (findings.length > 0) {
  console.error("Encoding verification failed. Potential mojibake detected:");
  for (const item of findings) {
    console.error(`- ${item.file}:${item.line}:${item.column} ${item.reason}`);
  }
  process.exit(1);
}

console.log("Encoding verification passed.");
