import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SparkMD5 from "spark-md5";

// 导入即把 mergeFileChunks 的 worker 消息监听注册到 jsdom 的 window（self === window）
import "../worker/merger.worker";

const dispatchMergeFile = (payload: unknown) => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "MERGE_FILE", payload },
    })
  );
};

const posted = () =>
  (
    vi.mocked(window.postMessage).mock.calls as unknown as Array<
      [{ type: string; payload?: { blob?: Blob; size?: number; error?: string } }]
    >
  ).map(([message]) => message);

const md5Of = (text: string) => {
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(new TextEncoder().encode(text).buffer);
  return spark.end();
};

const buildChunks = (parts: string[]) => parts.map((p) => new Blob([p]));

describe("合并终检（F5）", () => {
  beforeEach(() => {
    vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("expectedMd5 与合并内容一致 → MERGE_COMPLETE", async () => {
    const parts = ["hello ", "world", "!"];
    const merged = parts.join("");
    dispatchMergeFile({
      fileId: "f-ok",
      totalChunks: parts.length,
      mimeType: "text/plain",
      chunks: buildChunks(parts),
      expectedMd5: md5Of(merged),
    });

    await vi.waitFor(() => {
      expect(posted().some((m) => m.type === "MERGE_COMPLETE")).toBe(true);
    });
    const complete = posted().find((m) => m.type === "MERGE_COMPLETE");
    expect((complete?.payload?.blob as Blob | undefined)?.size).toBe(
      merged.length
    );
  });

  it("expectedMd5 不一致 → ERROR（不产出损坏文件）", async () => {
    const parts = ["hello ", "world", "!"];
    dispatchMergeFile({
      fileId: "f-bad",
      totalChunks: parts.length,
      mimeType: "text/plain",
      chunks: buildChunks(parts),
      expectedMd5: "deadbeef".repeat(8),
    });

    await vi.waitFor(() => {
      expect(posted().some((m) => m.type === "ERROR")).toBe(true);
    });
    expect(posted().some((m) => m.type === "MERGE_COMPLETE")).toBe(false);
  });

  it("未提供 expectedMd5 → 向后兼容，仍 MERGE_COMPLETE", async () => {
    const parts = ["abc", "def"];
    dispatchMergeFile({
      fileId: "f-legacy",
      totalChunks: parts.length,
      mimeType: "text/plain",
      chunks: buildChunks(parts),
    });

    await vi.waitFor(() => {
      expect(posted().some((m) => m.type === "MERGE_COMPLETE")).toBe(true);
    });
  });
});
