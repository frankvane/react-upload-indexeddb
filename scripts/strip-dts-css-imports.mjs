// P2-12：清掉 dist/**/*.d.ts 里的 CSS 副作用导入。
//
// 源码中以 `import "./ui/ui.css"` 引入样式，tsc --emitDeclarationOnly 会把这类
// 副作用导入原样写进 .d.ts；但发布包只有 dist/style.css，没有 dist/ui/ui.css，
// 关闭 skipLibCheck 的消费方会直接报 TS2307（找不到模块）。
// .d.ts 里的 CSS 导入对类型无任何意义，构建后统一剔除。

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIST_DIR = path.resolve(process.cwd(), "dist");
const CSS_IMPORT = /^\s*import\s+["'][^"']+\.css["'];?\s*$/;

const collectDts = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectDts(target)));
    } else if (entry.name.endsWith(".d.ts")) {
      files.push(target);
    }
  }
  return files;
};

const main = async () => {
  let files = [];
  try {
    files = await collectDts(DIST_DIR);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("[strip-dts-css] dist 不存在，跳过");
      return;
    }
    throw error;
  }

  let changed = 0;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const next = source
      .split(/\r?\n/)
      .filter((line) => !CSS_IMPORT.test(line))
      .join("\n");
    if (next !== source) {
      await writeFile(file, next, "utf8");
      changed += 1;
    }
  }

  console.log(
    `[strip-dts-css] 扫描 ${files.length} 个 .d.ts，清理 ${changed} 个文件中的 CSS 导入`
  );
};

await main();
