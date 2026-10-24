import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F3（SSRF / token 泄漏防护）+ P1（限速信号驱动的退避）合并回归测试。
 *
 * F3：下载 Worker 仅对命中白名单 host 的分片 URL 附加鉴权头（Authorization）；
 *     非白名单目标一律剥离 authHeaders 且不带 Cookie，避免把 Bearer 令牌发往任意域名。
 *
 * P1：失败批次退避仅在有"限速信号"时触发，且优先采用服务端 `Retry-After` 指示的时长；
 *     无信号时退化为默认 RETRY_DELAY（1000ms）。成功批次不再有任何固定等待。
 *
 * 沿用 downloader.worker.retry.test.ts 的加载方式：捕获 ctx.addEventListener('message')
 * 注册的 handler、拦截 postMessage 收集消息、mock fetch。
 */

const postedMessages: Array<Record<string, any>> = [];
let messageHandler: ((e: MessageEvent) => void) | null = null;
const timerDelays: number[] = [];

const dispatch = (data: unknown): void => {
  if (messageHandler) messageHandler({ data } as MessageEvent);
};

const waitForMessage = (
  predicate: (m: Record<string, any>) => boolean,
  timeoutMs = 15000
): Promise<Record<string, any>> =>
  new Promise<Record<string, any>>((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      const found = postedMessages.find(predicate);
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("等待 worker 消息超时"));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });

describe("downloader.worker（F3 + P1）", () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn> | null = null;
  let realSetTimeout: typeof setTimeout;

  beforeEach(() => {
    postedMessages.length = 0;
    messageHandler = null;
    timerDelays.length = 0;

    Object.defineProperty(self, "addEventListener", {
      configurable: true,
      writable: true,
      value: (type: string, handler: (e: MessageEvent) => void) => {
        if (type === "message") messageHandler = handler;
      },
    });
    Object.defineProperty(self, "postMessage", {
      configurable: true,
      writable: true,
      value: (message: unknown) => postedMessages.push(message),
    });

    realSetTimeout = setTimeout;
    setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    setTimeoutSpy.mockImplementation((cb: any, delay?: number) => {
      if (typeof delay === "number") timerDelays.push(delay);
      return realSetTimeout(cb as any, delay as any);
    });
  });

  afterEach(() => {
    setTimeoutSpy?.mockRestore();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("F3：白名单域名携带鉴权头，非白名单域名一律剥离", async () => {
    const fetchCalls: Array<{ url: string; headers: any }> = [];
    const fetchMock = vi.fn(async (url: string, opts?: any) => {
      fetchCalls.push({ url, headers: opts?.headers ?? {} });
      const range = opts?.headers?.Range as string | undefined;
      const m = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
      const start = Number(m?.[1]);
      const end = Number(m?.[2]);
      const body = new Uint8Array(end - start + 1).fill(1);
      return new Response(body, {
        status: 206,
        headers: { "Content-Range": `bytes ${start}-${end}/100` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("./downloader.worker");

    const auth = { Authorization: "Bearer secret-token" };
    dispatch({
      type: "START_DOWNLOAD",
      payload: {
        fileId: "allowed",
        url: "https://cdn.example.com/file.bin",
        fileSize: 100,
        chunkSize: 100,
        totalChunks: 1,
        pendingChunks: [0],
        chunkConcurrency: 1,
        fileConcurrency: 1,
        authHeaders: auth,
        allowedHosts: ["cdn.example.com"],
      },
    });
    dispatch({
      type: "START_DOWNLOAD",
      payload: {
        fileId: "evil",
        url: "https://evil.com/file.bin",
        fileSize: 100,
        chunkSize: 100,
        totalChunks: 1,
        pendingChunks: [0],
        chunkConcurrency: 1,
        fileConcurrency: 1,
        authHeaders: auth,
        allowedHosts: ["cdn.example.com"],
      },
    });

    await waitForMessage(
      (m) => m.type === "COMPLETE" && m.payload?.fileId === "allowed"
    );
    await waitForMessage(
      (m) => m.type === "COMPLETE" && m.payload?.fileId === "evil"
    );

    const allowedCall = fetchCalls.find((c) => c.url.includes("cdn.example.com"));
    const evilCall = fetchCalls.find((c) => c.url.includes("evil.com"));

    expect(allowedCall?.headers?.Authorization).toBe("Bearer secret-token");
    // 非白名单域名：绝不附加鉴权头（缓解 SSRF / token 泄漏）
    expect(evilCall?.headers?.Authorization).toBeUndefined();
  });

  it("P1：429 + Retry-After 优先采用服务端退避时长（非默认 1000ms）", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      }
      const body = new Uint8Array(100).fill(1);
      return new Response(body, {
        status: 206,
        headers: { "Content-Range": "bytes 0-99/100" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("./downloader.worker");

    dispatch({
      type: "START_DOWNLOAD",
      payload: {
        fileId: "rate",
        url: "https://example.com/file.bin",
        fileSize: 100,
        chunkSize: 100,
        totalChunks: 1,
        pendingChunks: [0],
        chunkConcurrency: 1,
        fileConcurrency: 1,
      },
    });

    await waitForMessage(
      (m) => m.type === "COMPLETE" && m.payload?.fileId === "rate",
      18000
    );
    // 退避时长应等于服务端 Retry-After（2s = 2000ms）
    expect(timerDelays).toContain(2000);
    // 且不应使用默认 RETRY_DELAY（1000ms）
    expect(timerDelays).not.toContain(1000);
  });

  it("P1：无限速信号时退化为默认 RETRY_DELAY（1000ms）", async () => {
    let attempt = 0;
    const fetchMock = vi.fn(async () => {
      attempt += 1;
      if (attempt <= 3) {
        return new Response("server error", { status: 500 });
      }
      const body = new Uint8Array(100).fill(1);
      return new Response(body, {
        status: 206,
        headers: { "Content-Range": "bytes 0-99/100" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await import("./downloader.worker");

    dispatch({
      type: "START_DOWNLOAD",
      payload: {
        fileId: "plain",
        url: "https://example.com/file.bin",
        fileSize: 100,
        chunkSize: 100,
        totalChunks: 1,
        pendingChunks: [0],
        chunkConcurrency: 1,
        fileConcurrency: 1,
      },
    });

    await waitForMessage(
      (m) => m.type === "COMPLETE" && m.payload?.fileId === "plain",
      18000
    );
    // 无 Retry-After：退化为固定 RETRY_DELAY（1000ms）
    expect(timerDelays).toContain(1000);
    expect(timerDelays).not.toContain(2000);
  });
});
