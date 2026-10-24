const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

process.env.NODE_ENV = "test";
const testDbStorage = path.join(__dirname, "tmp-test-list-cache.sqlite");
process.env.DB_STORAGE = testDbStorage;
process.env.CHUNK_STATE_FLUSH_INTERVAL_MS = "60000";
process.env.CHUNK_STATE_MAX_PENDING = "99999";
// 1000 个并发请求的派发耗时可能超过默认 5s TTL，放大 TTL 才能稳定验证"缓存命中零扫描"
process.env.LIST_CACHE_TTL_MS = "60000";

const app = require("../src/app");
const { syncModels, sequelize } = require("../src/models");
const { DOWNLOAD_DIR, ensureBaseDirs } = require("../src/config/paths");

const sampleFile = path.join(DOWNLOAD_DIR, "list-cache-sample.txt");

test.before(async () => {
  ensureBaseDirs();
  if (fs.existsSync(testDbStorage)) fs.unlinkSync(testDbStorage);
  await syncModels({ force: true });
  fs.writeFileSync(sampleFile, "list cache sample content", "utf8");
});

test.after(async () => {
  await sequelize.close();
  if (fs.existsSync(sampleFile)) fs.unlinkSync(sampleFile);
  if (fs.existsSync(testDbStorage)) fs.unlinkSync(testDbStorage);
});

test("/list 5s TTL 缓存：连续请求不重复全目录扫描", async () => {
  const readdirSpy = fs.promises.readdir;
  let calls = 0;
  // controller 持有 fs.promises 引用，替换其 readdir 方法即可计数
  const original = fs.promises.readdir;
  fs.promises.readdir = async (...args) => {
    if (String(args[0]).includes("tmp") || String(args[0]).includes("upload") || String(args[0]).includes("download")) {
      calls += 1;
    }
    return original.apply(fs.promises, args);
  };

  try {
    const first = await request(app).get("/api/file/list");
    assert.equal(first.status, 200);
    const firstCalls = calls;
    assert.ok(firstCalls >= 1, "首次列表至少扫描一次");

    const second = await request(app).get("/api/file/list");
    assert.equal(second.status, 200);
    assert.equal(calls, firstCalls, "TTL 内第二次列表不应再扫描");

    assert.deepEqual(
      second.body.data.files.map((f) => f.fileName).sort(),
      first.body.data.files.map((f) => f.fileName).sort()
    );
  } finally {
    fs.promises.readdir = original;
    void readdirSpy;
  }
});

test("下载非法 file_id 直接 404，不触发任何目录扫描（P1-14）", async () => {
  const original = fs.promises.readdir;
  let calls = 0;
  fs.promises.readdir = async (...args) => {
    calls += 1;
    return original.apply(fs.promises, args);
  };

  try {
    const res = await request(app).get("/api/file/download/not-a-valid-id!!");
    assert.equal(res.status, 404);
    assert.equal(calls, 0, "非法 id 不应触发 readdir");
  } finally {
    fs.promises.readdir = original;
  }
});

test("随机 1000 个不存在的合法 file_id：命中列表缓存，零额外扫描", async () => {
  // 先拉一次列表填充缓存
  await request(app).get("/api/file/list");

  const original = fs.promises.readdir;
  let calls = 0;
  fs.promises.readdir = async (...args) => {
    calls += 1;
    return original.apply(fs.promises, args);
  };

  try {
    const ids = Array.from({ length: 1000 }, (_, i) =>
      `${String(i).padStart(64, "0")}`
    );
    const results = await Promise.all(
      ids.map((id) => request(app).get(`/api/file/download/${id}`))
    );

    assert.ok(results.every((res) => res.status === 404));
    assert.equal(calls, 0, "1000 个未命中请求应在缓存内完成，零扫描");
  } finally {
    fs.promises.readdir = original;
  }
});

test("/list 分页参数：默认全量，传 page/pageSize 时切片并返回元信息", async () => {
  const full = await request(app).get("/api/file/list");
  assert.equal(full.status, 200);
  assert.equal(full.body.data.page, undefined, "默认不传分页字段");

  const paged = await request(app)
    .get("/api/file/list")
    .query({ page: 1, pageSize: 1 });
  assert.equal(paged.status, 200);
  assert.equal(paged.body.data.page, 1);
  assert.equal(paged.body.data.pageSize, 1);
  assert.ok(paged.body.data.files.length <= 1);
  assert.equal(paged.body.data.total, full.body.data.total);
});

test("合法 id 可正常下载（回归）", async () => {
  const list = await request(app).get("/api/file/list");
  const target = list.body.data.files.find(
    (f) => f.fileName === "list-cache-sample.txt"
  );
  assert.ok(target);

  const res = await request(app).get(`/api/file/download/${target.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.text, "list cache sample content");
});
