/**
 * P3-3 浏览器级冒烟（opt-in）：真实 Chromium + 真实 Worker + 真实 IndexedDB + 真实服务端。
 *
 * 现有单测全部跑在 jsdom + fake-indexeddb 上，覆盖不到：
 *  - Worker 的 `?worker&inline` 在真实浏览器里能否实例化；
 *  - IndexedDB 事务 / 配额 / Blob 存储在真实实现下的行为；
 *  - 真实 fetch + FormData + Range 请求链路。
 *
 * 流程：起服务端（临时数据目录）→ 起 vite dev（/api 代理到服务端）→ 打开 demo 页 →
 * 通过 file input 选一个 ~2.5MB 文件（自动切 3 片）→ 轮询服务端列表直到文件出现
 * 且 md5 与本地一致（说明上传 + 合并都真的跑通了）。
 *
 * 用法：npm run test:browser（需已安装 chromium：npx playwright install chromium）
 * 退出码：0 = 通过，1 = 失败。
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const SERVER_PORT = Number.parseInt(process.env.E2E_BROWSER_SERVER_PORT || "3211", 10);
const DEV_PORT = Number.parseInt(process.env.E2E_BROWSER_DEV_PORT || "5174", 10);
const SERVER_BASE = `http://localhost:${SERVER_PORT}`;
const DEV_BASE = `http://localhost:${DEV_PORT}`;
const FILE_SIZE = 1024 * 1024 * 2 + 4321; // 非整倍数，覆盖 partial 尾片
const TIMEOUT_MS = 90_000;

const log = (...args) => console.log("[browser-e2e]", ...args);
const fail = (msg) => {
  console.error("[browser-e2e] ✗", msg);
  throw new Error(msg);
};

const waitForHttp = async (url, timeoutMs = 30_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 尚未就绪
    }
    await sleep(300);
  }
  fail(`${url} 未在超时内就绪`);
};

const killTree = (child) => {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
};

const run = async () => {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rui-browser-"));
  const dataDir = path.join(tmpRoot, "data");
  const tmpUpload = path.join(tmpRoot, "tmp", "upload");
  const uploads = path.join(tmpRoot, "uploads");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(tmpUpload, { recursive: true });
  fs.mkdirSync(uploads, { recursive: true });

  const server = spawn(
    process.execPath,
    [path.join(projectRoot, "server", "src", "index.js")],
    {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        AUTH_MODE: "demo",
        NODE_ENV: "test",
        RATE_LIMIT_ENABLED: "false",
        LIST_CACHE_TTL_MS: "0",
        DB_STORAGE: path.join(dataDir, "browser-e2e.sqlite"),
        SERVER_DATA_DIR: dataDir,
        SERVER_TMP_UPLOAD_DIR: tmpUpload,
        SERVER_UPLOADS_DIR: uploads,
        SERVER_DOWNLOAD_DIR: path.join(tmpRoot, "download"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  server.stderr.on("data", (d) => process.stderr.write(`[server:err] ${d}`));

  const vite = spawn(
    process.execPath,
    [
      path.join(projectRoot, "node_modules", "vite", "bin", "vite.js"),
      "--port",
      String(DEV_PORT),
      "--strictPort",
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        VITE_DEV_API_PROXY_TARGET: SERVER_BASE,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  vite.stderr.on("data", (d) => process.stderr.write(`[vite:err] ${d}`));

  let browser;
  let exitCode = 1;
  try {
    await waitForHttp(`${SERVER_BASE}/api/health`);
    await waitForHttp(DEV_BASE);

    const payload = crypto.randomBytes(FILE_SIZE);
    const expectedMd5 = crypto.createHash("md5").update(payload).digest("hex");
    const fileName = `browser-e2e-${crypto.randomBytes(4).toString("hex")}.bin`;
    const filePath = path.join(tmpRoot, fileName);
    await fs.promises.writeFile(filePath, payload);

    log("启动 Chromium（headless）");
    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    log("打开 demo 页面");
    await page.goto(DEV_BASE, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });

    log(`选择文件 ${fileName}（${FILE_SIZE} 字节，自动分片）`);
    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: "attached", timeout: TIMEOUT_MS });
    await input.setInputFiles(filePath);

    // 以服务端列表为最终判据：文件出现即代表「分片上传 + 合并 + 落库」全链路在浏览器里跑通
    const deadline = Date.now() + TIMEOUT_MS;
    let matched = null;
    while (Date.now() < deadline) {
      const listed = await page.evaluate(async () => {
        const res = await fetch("/api/file/list");
        if (!res.ok) return null;
        const body = await res.json();
        return body?.data?.files ?? body?.files ?? null;
      });
      if (Array.isArray(listed)) {
        matched = listed.find((item) => item.fileName === fileName) || null;
        if (matched) break;
      }
      await sleep(500);
    }

    if (!matched) {
      fail(
        `浏览器上传未在 ${TIMEOUT_MS}ms 内完成（页面错误：${
          pageErrors.length ? pageErrors.join(" | ") : "无"
        }）`
      );
    }
    if (matched.md5 !== expectedMd5) {
      fail(`md5 不一致：服务端 ${matched.md5}，本地 ${expectedMd5}`);
    }
    if (matched.fileSize !== FILE_SIZE) {
      fail(`体积不一致：服务端 ${matched.fileSize}，本地 ${FILE_SIZE}`);
    }
    if (pageErrors.length > 0) {
      fail(`页面运行期抛错：${pageErrors.join(" | ")}`);
    }

    log(`✓ 浏览器端全链路通过：${fileName} md5=${matched.md5} size=${matched.fileSize}`);
    exitCode = 0;
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    killTree(vite);
    killTree(server);
    await fs.promises.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  return exitCode;
};

run()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
