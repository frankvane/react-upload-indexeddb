import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDownloaderLifecycle } from "./useDownloaderLifecycle";

// P1-7：下载编排层此前覆盖率为 0。这里覆盖 worker 生命周期与 P1-1 / P2-5 的关键时序。
const hoisted = vi.hoisted(() => {
  class FakeWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
  }
  const downloadWorkers: FakeWorker[] = [];
  const mergeWorkers: FakeWorker[] = [];
  return {
    downloadWorkers,
    mergeWorkers,
    createDownloadWorker: () => {
      const worker = new FakeWorker();
      downloadWorkers.push(worker);
      return worker as unknown as Worker;
    },
    createMergeWorker: () => {
      const worker = new FakeWorker();
      mergeWorkers.push(worker);
      return worker as unknown as Worker;
    },
  };
});

vi.mock("../worker", () => ({
  createDownloadWorker: hoisted.createDownloadWorker,
  createMergeWorker: hoisted.createMergeWorker,
}));

type FakeWorker = (typeof hoisted.downloadWorkers)[number];

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const createHandlers = () => ({
  onProgress: vi.fn(),
  onChunkDownloaded: vi.fn(async () => undefined),
  onComplete: vi.fn(async () => undefined),
  onError: vi.fn(),
  onPaused: vi.fn(async () => undefined),
  onMergeComplete: vi.fn(async () => undefined),
  onMergeError: vi.fn(),
});

const emit = (worker: FakeWorker, data: unknown) => {
  act(() => {
    worker.onmessage?.({ data } as MessageEvent);
  });
};

describe("useDownloaderLifecycle", () => {
  beforeEach(() => {
    hoisted.downloadWorkers.length = 0;
    hoisted.mergeWorkers.length = 0;
  });

  it("创建两个 worker，并把进度 / 暂停 / 错误消息路由给处理器", () => {
    const handlers = createHandlers();
    renderHook(() => useDownloaderLifecycle(handlers));

    expect(hoisted.downloadWorkers).toHaveLength(1);
    expect(hoisted.mergeWorkers).toHaveLength(1);

    const worker = hoisted.downloadWorkers.at(-1)!;
    emit(worker, {
      type: "PROGRESS",
      payload: { fileId: "f1", progress: 42, downloadedChunks: 3 },
    });
    emit(worker, { type: "PAUSED", payload: { fileId: "f1" } });
    emit(worker, { type: "ERROR", payload: { fileId: "f1", error: "boom" } });

    expect(handlers.onProgress).toHaveBeenCalledWith({
      fileId: "f1",
      progress: 42,
      downloadedChunks: 3,
    });
    expect(handlers.onPaused).toHaveBeenCalledWith({ fileId: "f1" });
    expect(handlers.onError).toHaveBeenCalledWith({ fileId: "f1", error: "boom" });
  });

  it("P1-1：COMPLETE 前等待该文件全部落盘任务完成", async () => {
    const handlers = createHandlers();
    renderHook(() => useDownloaderLifecycle(handlers));
    const worker = hoisted.downloadWorkers.at(-1)!;

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    handlers.onChunkDownloaded.mockImplementation(async () => {
      await gate;
    });

    emit(worker, {
      type: "CHUNK_DOWNLOADED",
      payload: { fileId: "f1", chunkIndex: 0, blob: new Blob(["a"]), size: 1 },
    });
    emit(worker, {
      type: "CHUNK_DOWNLOADED",
      payload: { fileId: "f1", chunkIndex: 1, blob: new Blob(["b"]), size: 1 },
    });
    emit(worker, { type: "COMPLETE", payload: { fileId: "f1" } });

    await flush();
    expect(handlers.onComplete).not.toHaveBeenCalled();

    release();
    await flush();
    await flush();

    expect(handlers.onChunkDownloaded).toHaveBeenCalledTimes(2);
    expect(handlers.onComplete).toHaveBeenCalledTimes(1);
  });

  it("P2-5：落盘失败在 COMPLETE 时上报，而不是误报完成", async () => {
    const handlers = createHandlers();
    handlers.onChunkDownloaded.mockRejectedValue(new Error("QuotaExceededError"));
    renderHook(() => useDownloaderLifecycle(handlers));
    const worker = hoisted.downloadWorkers.at(-1)!;

    emit(worker, {
      type: "CHUNK_DOWNLOADED",
      payload: { fileId: "f1", chunkIndex: 0, blob: new Blob(["a"]), size: 1 },
    });
    emit(worker, { type: "COMPLETE", payload: { fileId: "f1" } });

    await flush();
    await flush();

    expect(handlers.onComplete).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith({
      fileId: "f1",
      error: "分片落盘失败: QuotaExceededError",
    });
  });

  it("合并 worker 的消息分别路由到 onMergeComplete / onMergeError", () => {
    const handlers = createHandlers();
    renderHook(() => useDownloaderLifecycle(handlers));
    const mergeWorker = hoisted.mergeWorkers.at(-1)!;
    const blob = new Blob(["merged"]);

    emit(mergeWorker, {
      type: "MERGE_COMPLETE",
      payload: { fileId: "f1", blob },
    });
    emit(mergeWorker, { type: "ERROR", payload: { fileId: "f1", error: "bad" } });

    expect(handlers.onMergeComplete).toHaveBeenCalledWith({ fileId: "f1", blob });
    expect(handlers.onMergeError).toHaveBeenCalledWith({
      fileId: "f1",
      error: "bad",
    });
  });

  it("卸载时终止两个 worker", () => {
    const handlers = createHandlers();
    const { unmount } = renderHook(() => useDownloaderLifecycle(handlers));

    unmount();

    expect(hoisted.downloadWorkers.at(-1)!.terminate).toHaveBeenCalledTimes(1);
    expect(hoisted.mergeWorkers.at(-1)!.terminate).toHaveBeenCalledTimes(1);
  });
});
