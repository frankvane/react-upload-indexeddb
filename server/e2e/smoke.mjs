/**
 * E3 端到端冒烟：上传 → 合并 → 列表 → 分片下载 → 合并 → md5 比对。
 *
 * 全程走真实服务端 API（与浏览器 Worker 相同的端点 / 分片方案 / Range 请求），
 * 验证"全链路不损坏"：上传字节 === 下载字节（md5 一致）。
 *
 * 服务端用临时数据目录（不污染仓库），`AUTH_MODE=demo` 关闭鉴权。
 * 子进程复用当前 node（推荐以 Node 24 运行，匹配 better-sqlite3 原生二进制）。
 *
 * 用法：node e2e/smoke.mjs            （也可 npm run e2e）
 * 退出码：0 = 通过，1 = 失败。
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_PORT = Number.parseInt(process.env.E2E_PORT || "3210", 10);
const BASE = `http://localhost:${SERVER_PORT}`;
const CHUNK_SIZE = 1024 * 1024; // 1 MiB
// 非整倍数：最后一个分片为不完整的 partial，顺带验证 Content-Range 边界
const FILE_SIZE = CHUNK_SIZE * 3 + 12345;

const log = (...args) => console.log("[e2e]", ...args);
const fail = (msg) => {
  console.error("[e2e] ✗", msg);
  throw new Error(msg);
};

const md5Buffer = (buf) => crypto.createHash("md5").update(buf).digest("hex");

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // 服务尚未就绪
    }
    await sleep(300);
  }
  fail("server /api/health 未在超时内就绪");
}

async function uploadChunk(fileId, index, chunkBuf, fullMd5, user_id) {
  const form = new FormData();
  form.append("file_id", fileId);
  form.append("index", String(index));
  form.append("chunk_md5", md5Buffer(chunkBuf));
  form.append("user_id", user_id);
  form.append("chunk", new Blob([chunkBuf], { type: "application/octet-stream" }), "chunk.bin");

  const res = await fetch(`${BASE}/api/file/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text();
    fail(`分片 ${index} 上传失败 ${res.status}: ${body}`);
  }
}

async function mergeChunks(fileId, fullMd5, name, size, total, user_id) {
  const res = await fetch(`${BASE}/api/file/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileId,
      md5: fullMd5,
      name,
      size,
      total,
      user_id,
      hash_mode: "full",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(`合并失败 ${res.status}: ${JSON.stringify(body)}`);
  if (body.code !== 200) fail(`合并返回非 200: ${JSON.stringify(body)}`);
  return body;
}

async function findFileByMd5(fullMd5, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE}/api/file/list`);
    if (!res.ok) fail(`列表请求失败 ${res.status}`);
    const body = await res.json();
    const hit = (body.data?.files || []).find((f) => f.md5 && f.md5.toLowerCase() === fullMd5.toLowerCase());
    if (hit) return hit;
    await sleep(400);
  }
  fail("合并后未在文件列表中找到该 md5");
}

async function downloadRange(fileId, start, end, expectedSize) {
  const res = await fetch(`${BASE}/api/file/download/${fileId}`, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  if (res.status !== 206) fail(`下载分片 ${start}-${end} 期望 206，实际 ${res.status}`);
  const cr = res.headers.get("Content-Range");
  const m = /^bytes (\d+)-(\d+)\/(?:\d+|\*)$/.exec(cr || "");
  if (!m) fail(`下载分片 ${start}-${end} 缺少合法 Content-Range，实际: ${cr}`);
  const crStart = Number(m[1]);
  const crEnd = Number(m[2]);
  if (crStart !== start || crEnd !== end) {
    fail(`下载分片 Content-Range(${crStart}-${crEnd}) 与请求(${start}-${end}) 不一致`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== end - start + 1) {
    fail(`下载分片字节数 ${buf.length} 与期望 ${end - start + 1} 不一致`);
  }
  return buf;
}

async function downloadFull(fileId) {
  const res = await fetch(`${BASE}/api/file/download/${fileId}`);
  if (!res.ok) fail(`整文件下载失败 ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  // 隔离数据目录
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rui-e2e-"));
  const dataDir = path.join(tmpRoot, "data");
  const tmpUpload = path.join(tmpRoot, "tmp", "upload");
  const uploads = path.join(tmpRoot, "uploads");
  const downloads = path.join(tmpRoot, "download");
  [dataDir, tmpUpload, uploads, downloads].forEach((d) => fs.mkdirSync(d, { recursive: true }));

  const dbStorage = path.join(dataDir, "e2e.sqlite");

  const env = {
    ...process.env,
    PORT: String(SERVER_PORT),
    AUTH_MODE: "demo",
    NODE_ENV: "test",
    RATE_LIMIT_ENABLED: "false",
    LIST_CACHE_TTL_MS: "0",
    DB_STORAGE: dbStorage,
    SERVER_DATA_DIR: dataDir,
    SERVER_TMP_UPLOAD_DIR: tmpUpload,
    SERVER_UPLOADS_DIR: uploads,
    SERVER_DOWNLOAD_DIR: downloads,
  };

  log(`启动参考服务端（临时数据目录 ${tmpRoot}，端口 ${SERVER_PORT}）`);
  const server = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[server:err] ${d}`));

  let exitCode = 1;
  try {
    await waitForHealth();

    // 生成随机文件并计算权威 md5
    const original = crypto.randomBytes(FILE_SIZE);
    const fullMd5 = md5Buffer(original);
    const fileId = `e2e-${crypto.randomBytes(8).toString("hex")}`;
    const user_id = "e2e-smoke";
    const name = `e2e-smoke-${Date.now()}.bin`;

    const total = Math.ceil(FILE_SIZE / CHUNK_SIZE);
    log(`上传 ${FILE_SIZE} 字节（${total} 个分片，分片大小 ${CHUNK_SIZE}）`);
    for (let i = 0; i < total; i += 1) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, FILE_SIZE);
      const chunkBuf = original.subarray(start, end);
      await uploadChunk(fileId, i, chunkBuf, fullMd5, user_id);
    }

    log("请求合并");
    await mergeChunks(fileId, fullMd5, name, FILE_SIZE, total, user_id);

    log("轮询文件列表");
    const file = await findFileByMd5(fullMd5);
    log(`列表命中：id=${file.id} md5=${file.md5} size=${file.fileSize}`);
    if (Number(file.fileSize) !== FILE_SIZE) fail(`列表文件大小 ${file.fileSize} ≠ 上传 ${FILE_SIZE}`);

    // 分片下载（镜像客户端 F4：206 + Content-Range + 字节数校验）
    log("分片 Range 下载并重组");
    const pieces = [];
    for (let i = 0; i < total; i += 1) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, FILE_SIZE) - 1;
      pieces.push(await downloadRange(file.id, start, end, end - start + 1));
    }
    const reassembled = Buffer.concat(pieces);
    const reassembledMd5 = md5Buffer(reassembled);
    if (reassembledMd5 !== fullMd5) {
      fail(`分片重组 md5(${reassembledMd5}) ≠ 原始 md5(${fullMd5}) —— 全链路损坏`);
    }

    // 整文件下载交叉校验
    log("整文件下载交叉校验");
    const full = await downloadFull(file.id);
    if (md5Buffer(full) !== fullMd5) {
      fail(`整文件下载 md5(${md5Buffer(full)}) ≠ 原始 md5(${fullMd5})`);
    }
    if (full.length !== FILE_SIZE) fail(`整文件长度 ${full.length} ≠ ${FILE_SIZE}`);

    log("✓ 端到端 round-trip 通过：上传字节 === 下载字节（md5 一致）");
    exitCode = 0;
  } catch (err) {
    console.error("[e2e] ✗", err.message);
    exitCode = 1;
  } finally {
    server.kill("SIGTERM");
    try {
      await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      /* 忽略清理失败 */
    }
  }
  process.exit(exitCode);
}

main();
