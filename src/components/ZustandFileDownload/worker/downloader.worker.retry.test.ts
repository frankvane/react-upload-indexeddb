import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F8 下载 Worker 重试回归测试：MAX_RETRY_ATTEMPTS=3 现在语义为"3 次重试 / 4 次尝试"。
 *  - 用例1（核心回归）：单个分片"前 3 次尝试均失败、第 4 次成功"。
 *    修复后（文件级 `>` + 分片级 `> MAX+1` 一致）整文件应 COMPLETE；
 *    修复前（分片级 `> MAX` 仅允许 3 次尝试 + 文件级 `>=`）会在第 3 次失败后误判超限并 ERROR 中止。
 *  - 用例2（守卫）：分片始终失败时，仍应在达到上限后 ERROR（确保 abort 路径未被破坏）。
 *
 * 直接加载 downloader.worker 模块（经 ctx.addEventListener('message') 注册处理，ctx = self），
 * mock fetch + 捕获 message handler + 拦截 postMessage 收集消息。
 */

const postedMessages: Array<Record<string, any>> = [];
let messageHandler: ((e: MessageEvent) => void) | null = null;

const makeFetchMock = (mode: "recover" | "alwaysFail") => {
  let callCount = 0;
  return vi.fn(async (_url: string, opts?: any) => {
    callCount += 1;
    if (mode === "alwaysFail" || callCount <= 3) {
      return new Response("server error", { status: 500 });
    }
    const range: string | undefined = opts?.headers?.Range;
    const m = /^bytes=(\d+)-(\d+)$/.exec(range as string);
    const start = Number(m?.[1]);
    const end = Number(m?.[2]);
    const body = new Uint8Array(end - start + 1).fill(1);
    return new Response(body, {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/100` },
    });
  });
};

const dispatch = (data: unknown) => {
  if (messageHandler) messageHandler({ data } as MessageEvent);
};

const waitForMessage = (
  predicate: (m: Record<string, any>) => boolean,
  timeoutMs = 15000
) =>
  new Promise<Record<string, any>>((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
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

describe("downloader.worker 重试（F8：3 次重试 / 4 次尝试）", () => {
  beforeEach(async () => {
    postedMessages.length = 0;
    messageHandler = null;

    // 捕获 worker 经 ctx.addEventListener('message', handler) 注册的 handler，
    // 并拦截 postMessage 收集消息。ctx = self（jsdom window）。
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it(
    "分片前 3 次失败、第 4 次成功 → 整文件 COMPLETE（修复前会误中止）",
    async () => {
      const fetchMock = makeFetchMock("recover");
      vi.stubGlobal("fetch", fetchMock);
      await import("./downloader.worker");

      const fileId = "f8-recover-case";
      dispatch({
        type: "START_DOWNLOAD",
        payload: {
          fileId,
          url: "https://example.com/file.bin",
          fileSize: 100,
          chunkSize: 100,
          totalChunks: 1,
          pendingChunks: [0],
          chunkConcurrency: 1,
          fileConcurrency: 1,
        },
      });

      const done = await waitForMessage(
        (m) => m.type === "COMPLETE" && m.payload?.fileId === fileId,
        18000
      );

      expect(done.type).toBe("COMPLETE");
      expect(
        postedMessages.some(
          (m) => m.type === "ERROR" && m.payload?.fileId === fileId
        )
      ).toBe(false);
      // 分片被尝试 4 次（前 3 次 500，第 4 次 206），证明重试次数上限与文件级一致
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
    },
    20000
  );

  it(
    "分片始终失败时仍应在达到上限后 ERROR（abort 路径不被破坏）",
    async () => {
      const fetchMock = makeFetchMock("alwaysFail");
      vi.stubGlobal("fetch", fetchMock);
      await import("./downloader.worker");

      const fileId = "f8-always-fail-case";
      dispatch({
        type: "START_DOWNLOAD",
        payload: {
          fileId,
          url: "https://example.com/file.bin",
          fileSize: 100,
          chunkSize: 100,
          totalChunks: 1,
          pendingChunks: [0],
          chunkConcurrency: 1,
          fileConcurrency: 1,
        },
      });

      const err = await waitForMessage(
        (m) => m.type === "ERROR" && m.payload?.fileId === fileId,
        18000
      );

      expect(err.type).toBe("ERROR");
      expect(
        postedMessages.some(
          (m) => m.type === "COMPLETE" && m.payload?.fileId === fileId
        )
      ).toBe(false);
    },
    20000
  );
});
