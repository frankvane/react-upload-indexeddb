import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const countEffectiveLines = (relativePath) => {
  const fullPath = join(root, relativePath);
  if (!existsSync(fullPath)) {
    return null;
  }

  const content = readFileSync(fullPath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
};

const hookMetrics = {
  uploadHook: countEffectiveLines(
    "src/components/ZustandFileUpload/hooks/useBatchUploader.ts"
  ),
  downloadHook: countEffectiveLines(
    "src/components/ZustandFileDownload/hooks/useFileDownloader.ts"
  ),
  uploadController: countEffectiveLines(
    "src/components/ZustandFileUpload/hooks/useBatchUploaderController.ts"
  ),
  downloadController: countEffectiveLines(
    "src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts"
  ),
};

const distDir = join(root, "dist");
const distAssetsDir = join(distDir, "assets");
let mainBundle = null;
let splitBundles = [];
let allJsBundles = [];
let largestJsBundle = null;

if (existsSync(distAssetsDir)) {
  allJsBundles = readdirSync(distAssetsDir)
    .filter((name) => name.toLowerCase().endsWith(".js"))
    .map((name) => {
      const size = statSync(join(distAssetsDir, name)).size;
      return {
        file: name,
        bytes: size,
        kb: Number((size / 1024).toFixed(2)),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);

  largestJsBundle = allJsBundles[0] ?? null;

  const files = readdirSync(distAssetsDir).filter((name) =>
    /^index-.*\.js$/i.test(name)
  );

  splitBundles = files
    .map((name) => {
      const size = statSync(join(distAssetsDir, name)).size;
      return {
        file: name,
        bytes: size,
        kb: Number((size / 1024).toFixed(2)),
      };
    })
    .sort((a, b) => b.bytes - a.bytes);

  const htmlPath = join(distDir, "index.html");
  let entryBundleFile = null;

  if (existsSync(htmlPath)) {
    const html = readFileSync(htmlPath, "utf8");
    const match = html.match(/<script[^>]+src="\/assets\/(index-[^"]+\.js)"/i);
    if (match?.[1]) {
      entryBundleFile = match[1];
    }
  }

  const selectedBundle =
    splitBundles.find((bundle) => bundle.file === entryBundleFile) ??
    splitBundles[0] ??
    null;

  if (selectedBundle) {
    mainBundle = {
      ...selectedBundle,
      selectedBy: entryBundleFile ? "index.html-entry" : "largest-index-chunk",
    };
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  hookMetrics,
  mainBundle,
  splitBundles,
  largestJsBundle,
  allJsBundles,
};

const outputPath = join(root, "docs", "refactor-metrics-latest.json");
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log("Refactor metrics collected.");
console.log(JSON.stringify(result, null, 2));
