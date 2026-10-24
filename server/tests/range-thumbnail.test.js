const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = "test";
// 列表缓存 TTL 置 0，避免共享进程下其它测试文件的缓存干扰本文件 fresh 扫描
process.env.LIST_CACHE_TTL_MS = "0";
process.env.DB_STORAGE = path.join(__dirname, "tmp-test-rt.sqlite");
process.env.CHUNK_STATE_FLUSH_INTERVAL_MS = "60000";
process.env.CHUNK_STATE_MAX_PENDING = "99999";
process.env.AUTH_MODE = "demo";
process.env.RATE_LIMIT_ENABLED = "false";

const app = require("../src/app");
const { syncModels } = require("../src/models");
const { DOWNLOAD_DIR, ensureBaseDirs } = require("../src/config/paths");

const FILE_NAME = `range-thumb-${Date.now()}.txt`;
const FILE_CONTENT = "0123456789"; // 10 字节
const FILE_PATH = path.join(DOWNLOAD_DIR, FILE_NAME);

const fileId = crypto.createHash("sha256").update(path.resolve(FILE_PATH)).digest("hex");

test.before(async () => {
  ensureBaseDirs();
  if (fs.existsSync(process.env.DB_STORAGE)) fs.unlinkSync(process.env.DB_STORAGE);
  await syncModels({ force: true });
  fs.writeFileSync(FILE_PATH, FILE_CONTENT, "utf8");
});

test.after(() => {
  if (fs.existsSync(FILE_PATH)) fs.unlinkSync(FILE_PATH);
});

test("S11：单段 Range 正常返回 206 + 正确 Content-Range + 字节", async () => {
  const res = await request(app)
    .get(`/api/file/download/${fileId}`)
    .set("Range", "bytes=0-4")
    .buffer(true)
    .parse((r, cb) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 206);
  assert.equal(res.headers["content-range"], `bytes 0-4/${FILE_CONTENT.length}`);
  assert.equal(res.headers["accept-ranges"], "bytes");
  assert.equal(res.body.toString("utf8"), "01234");
});

test("S11：多段 Range 被显式拒绝（416 + Content-Range: bytes */size）", async () => {
  const res = await request(app)
    .get(`/api/file/download/${fileId}`)
    .set("Range", "bytes=0-4,6-9")
    .buffer(true);
  assert.equal(res.status, 416);
  assert.equal(res.headers["content-range"], `bytes */${FILE_CONTENT.length}`);
  assert.equal(res.headers["accept-ranges"], "bytes");
});

test("S11：无 Range 时整文件返回 200 且内容完整", async () => {
  const res = await request(app)
    .get(`/api/file/download/${fileId}`)
    .buffer(true)
    .parse((r, cb) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.toString("utf8"), FILE_CONTENT);
});

test("S11：非法 Range 返回 416", async () => {
  const res = await request(app)
    .get(`/api/file/download/${fileId}`)
    .set("Range", "bytes=999-0")
    .buffer(true);
  assert.equal(res.status, 416);
  assert.equal(res.headers["content-range"], `bytes */${FILE_CONTENT.length}`);
});

test("S10：无缩略图实体时返回 404（缩略图路由已就绪，待 CVE-free thumbnailer）", async () => {
  const res = await request(app).get(`/api/file/thumbnail/${fileId}`);
  assert.equal(res.status, 404);
});

test("S10：非法 file_id 直接 404，不做目录扫描", async () => {
  const res = await request(app).get("/api/file/thumbnail/not-a-valid-id");
  assert.equal(res.status, 404);
});
