import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 导入即把模块内的 message 监听注册到 jsdom 的 window（self === window）
import "../worker/downloader.worker";

interface StartDownloadPayload {
  fileId: string;
  url: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  pendingChunks: number[];
  authHeaders?: Record<string, string>;
  withCredentials?: boolean;
}

const dispatchStartDownload = (payload: StartDownloadPayload) => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "START_DOWNLOAD", payload },
    })
  );
};

const postedTypes = () =>
  (
    vi.mocked(window.postMessage).mock.calls as unknown as Array<
      [{ type: string }]
    >
  ).map(([message]) => message.type);

describe("下载 Worker 分片请求鉴权（P0-1）", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // 真实还原服务端 206 + Content-Range 行为（F4 校验依赖），按 Range 返回对应大小的分片
    fetchMock.mockImplementation(async (_url, init) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      const m = /bytes=(\d+)-(\d+)/.exec(headers.Range || "");
      const s = m ? Number(m[1]) : 0;
      const e = m ? Number(m[2]) : 0;
      const size = e - s + 1;
      return {
        ok: true,
        status: 206,
        headers: {
          get: (h: string) =>
            h.toLowerCase() === "content-range"
              ? `bytes ${s}-${e}/100`
              : null,
        },
        blob: async () => new Blob([new Uint8Array(Math.max(size, 0))]),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Bearer 头 + withCredentials:true 时 fetch 合并 Authorization 与 credentials:include", () => {
    dispatchStartDownload({
      fileId: "file-bearer-include",
      url: "https://cdn.example.com/api/file/download/file-bearer-include",
      fileSize: 100,
      chunkSize: 100,
      totalChunks: 1,
      pendingChunks: [0],
      authHeaders: { Authorization: "Bearer test-token" },
      withCredentials: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://cdn.example.com/api/file/download/file-bearer-include"
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers.Range).toBe("bytes=0-99");
    expect(init.credentials).toBe("include");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("无鉴权配置时默认 same-origin 且仅带 Range 头", () => {
    dispatchStartDownload({
      fileId: "file-default",
      url: "https://cdn.example.com/api/file/download/file-default",
      fileSize: 100,
      chunkSize: 100,
      totalChunks: 1,
      pendingChunks: [0],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Range).toBe("bytes=0-99");
    expect(init.credentials).toBe("same-origin");
  });

  it("自定义鉴权头（getAuthHeaders 场景）原样合并", () => {
    dispatchStartDownload({
      fileId: "file-custom-headers",
      url: "https://cdn.example.com/api/file/download/file-custom-headers",
      fileSize: 100,
      chunkSize: 100,
      totalChunks: 1,
      pendingChunks: [0],
      authHeaders: {
        Authorization: "Bearer t",
        "X-Tenant-Id": "tenant-1",
      },
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Tenant-Id"]).toBe("tenant-1");
    expect(headers.Authorization).toBe("Bearer t");
    expect(headers.Range).toBe("bytes=0-99");
  });

  it("分片下载成功后向主线程上报 CHUNK_DOWNLOADED", async () => {
    dispatchStartDownload({
      fileId: "file-chunk-ok",
      url: "https://cdn.example.com/api/file/download/file-chunk-ok",
      fileSize: 100,
      chunkSize: 100,
      totalChunks: 1,
      pendingChunks: [0],
      authHeaders: { Authorization: "Bearer test-token" },
    });

    await vi.waitFor(() => {
      expect(postedTypes()).toContain("CHUNK_DOWNLOADED");
    });
  });

  it("F4：返回 200（非 206）时分片不会被判为成功", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      blob: async () => new Blob([new Uint8Array(100)]),
    }));

    dispatchStartDownload({
      fileId: "file-no-206",
      url: "https://cdn.example.com/api/file/download/file-no-206",
      fileSize: 100,
      chunkSize: 100,
      totalChunks: 1,
      pendingChunks: [0],
    });

    // 非 206 立即判失败并重试，短时间内不应出现 CHUNK_DOWNLOADED
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(postedTypes()).not.toContain("CHUNK_DOWNLOADED");
  });
});
