import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");

const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const forbiddenPatterns = [
  { label: "legacy /api/files path", pattern: /\/api\/files\b/g },
  {
    label: "hard-coded localhost base URL",
    pattern: /http:\/\/localhost:3000/g,
  },
];

const findings = [];
let apiPathHits = 0;

const walk = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    const ext = path.extname(entry.name);
    if (!codeExtensions.has(ext)) continue;

    const content = fs.readFileSync(fullPath, "utf8");
    apiPathHits += (content.match(/\/api\/file\//g) || []).length;

    for (const { label, pattern } of forbiddenPatterns) {
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        findings.push({
          file: path.relative(rootDir, fullPath),
          label,
          snippet: match[0],
        });
      }
    }
  }
};

walk(srcDir);

if (apiPathHits === 0) {
  console.error("No /api/file/* usage found in source files.");
  process.exit(1);
}

if (findings.length > 0) {
  console.error("Client API contract verification failed:");
  for (const finding of findings) {
    console.error(
      `- ${finding.file}: found ${finding.label} (${finding.snippet})`
    );
  }
  process.exit(1);
}

console.log("Client API contract verification passed.");
