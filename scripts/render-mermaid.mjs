/**
 * 将 README 中的 Mermaid 图渲染为 PNG（npmjs.com 不渲染 Mermaid，
 * README 内使用 GitHub raw 绝对 URL 引用这些 PNG）。
 *
 * 用法：node scripts/render-mermaid.mjs
 * 依赖：devDependencies 的 mermaid + playwright（chromium）
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// UMD 单文件构建：内联进临时 HTML，规避 file:// 下 ESM import 的 CORS 限制
const mermaidJs = readFileSync(
  require.resolve("mermaid/dist/mermaid.min.js"),
  "utf8"
);

const diagrams = [
  {
    name: "architecture",
    code: `flowchart LR
  User["用户操作"] --> UI["React 页面<br/>上传/下载/简化"]
  UI --> Net["网络状态检测<br/>online/rtt/downlink"]
  Net --> Policy["自动策略引擎<br/>chunkSize + file/chunk 并发"]
  Policy --> Upload["Upload 模块<br/>自动上传"]
  UI --> Download["Download 模块"]
  Upload --> UWorker["Upload Workers<br/>预处理/分片/上传"]
  Upload --> AutoCleanup["自动清理定时器"]
  UWorker <--> UploadIDB["IndexedDB<br/>上传队列/分片状态"]
  Download --> DWorker["Download Workers<br/>下载/合并"]
  DWorker <--> DownloadIDB["IndexedDB<br/>下载分片/进度"]
  UWorker --> API["/api/file/*"]
  DWorker --> API
  API --> Server["Express + Sequelize"]
  Server --> DB[(SQLite)]
  Server --> FS["uploads / download / tmp"]`,
  },
  {
    name: "upload-sequence",
    code: `sequenceDiagram
  participant U as 用户
  participant C as 前端上传模块
  participant P as 自动策略引擎
  participant IDB as IndexedDB
  participant W as Upload Worker
  participant S as 服务端 API
  U->>C: 选择文件
  C->>P: 采集网络状态并计算策略
  P-->>C: chunkSize + 并发度
  C->>W: 自动入队并启动上传
  W->>IDB: 保存上传队列与分片状态
  W->>S: POST /instant（秒传/分片检查）
  alt 已存在
    S-->>W: uploaded=true（秒传）
  else 需上传
    loop 分片上传
      W->>S: POST /upload
      W->>IDB: 持久化分片进度
    end
    W->>S: POST /merge
  end
  W-->>C: 文件完成事件
  C->>S: 刷新 /list`,
  },
  {
    name: "download-sequence",
    code: `sequenceDiagram
  participant U as 用户
  participant C as 前端下载模块
  participant W as Download Worker
  participant S as 服务端 API
  participant IDB as IndexedDB
  U->>C: 打开下载页
  C->>S: GET /list
  S-->>C: 文件清单
  U->>C: 点击下载
  C->>IDB: 读取历史下载进度
  alt 存在历史进度
    IDB-->>C: 返回已完成分片
    C->>W: 从断点继续下载
  else 无历史进度
    C->>W: 创建分片下载任务
  end
  loop 分片拉取
    W->>S: GET /download/:id (Range)
    W->>IDB: 缓存分片
  end
  W->>W: 合并文件
  W-->>C: 完成事件
  C-->>U: 导出文件`,
  },
];

const outDir = resolve(process.cwd(), "docs/assets/readme");
mkdirSync(outDir, { recursive: true });
const tmpHtml = resolve(outDir, "_render-tmp.html");

const browser = await chromium.launch();
const page = await browser.newPage({
  deviceScaleFactor: 2,
  viewport: { width: 1600, height: 900 },
});
page.on("console", (m) => {
  if (m.type() === "error") console.error("[console]", m.text());
});
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

for (const { name, code } of diagrams) {
  writeFileSync(
    tmpHtml,
    `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>body{margin:0;padding:16px;background:#ffffff;font-family:sans-serif;}#graph{display:inline-block;}</style>
</head><body><div class="mermaid" id="graph">${code}</div>
<script>${mermaidJs}<\/script>
<script>
  (async () => {
    mermaid.initialize({ startOnLoad: false, theme: "default", fontFamily: "sans-serif" });
    const { svg } = await mermaid.render("mmd", document.getElementById("graph").textContent);
    document.getElementById("graph").innerHTML = svg;
    window.__done = true;
  })();
</script></body></html>`,
    "utf8"
  );
  await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: "load" });
  await page.waitForFunction(() => window.__done === true, undefined, {
    timeout: 30000,
  });
  await page.waitForTimeout(200);
  const el = page.locator("#graph");
  await el.screenshot({ path: resolve(outDir, `${name}.png`) });
  console.log(`rendered ${name}.png`);
}

rmSync(tmpHtml, { force: true });
await browser.close();
