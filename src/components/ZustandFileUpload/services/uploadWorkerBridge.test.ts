import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UploadFile } from "../types/upload";

interface PostedMessage {
  type: string;
  uploadConfig?: Record<string, unknown>;
}

class FakeUploadWorker {
  static instances: FakeUploadWorker[] = [];
  /** false 时挂起任务（不自动回 done），用于取消测试 */
  static autoRespond = true;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  posted: PostedMessage[] = [];
  terminated = false;

  constructor() {
    FakeUploadWorker.instances.push(this);
  }

  postMessage(message: PostedMessage) {
    this.posted.push(message);
    if (!FakeUploadWorker.autoRespond) {
      return;
    }
    // 立即以 done 收尾，让 runUploadTask 的 Promise 落地
    this.onmessage?.({ data: { type: "done", skipped: false } } as MessageEvent);
  }

  terminate() {
    this.terminated = true;
  }
}

vi.mock("../worker/uploadWorker.ts?worker&inline", () => ({
  default: FakeUploadWorker,
}));

const { runUploadTask, disposeUploadWorkerPool, cancelUploadTask } = await import(
  "./uploadWorkerBridge"
);

const apiConfig = {
  baseURL: "",
  uploadApi: "/api/file/upload",
  checkApi: "/api/file/instant",
  mergeApi: "/api/file/merge",
};

const createFile = (): UploadFile =>
  ({
    id: "file-1",
    fileName: "demo.bin",
    fileSize: 1024,
    hash: "a".repeat(32),
    chunkSize: 1024 * 1024,
  }) as unknown as UploadFile;

const baseOptions = () => ({
  file: createFile(),
  fileRef: new File([new Uint8Array(8)], "demo.bin"),
  networkParams: {
    networkType: "wifi",
    fileConcurrency: 2,
    chunkConcurrency: 2,
    chunkSize: 1024 * 1024,
    maxRetries: 3,
  },
});

describe("runUploadTask uploadConfig 贯通（T2.1 mergeApi）", () => {
  beforeEach(() => {
    // 清空全局 worker 池，保证每个测试从干净状态开始
    disposeUploadWorkerPool();
    FakeUploadWorker.instances = [];
  });

  it("mergeApi 随 uploadConfig 下发到 Worker", async () => {
    await runUploadTask({
      ...baseOptions(),
      uploadConfig: {
        baseURL: "https://upload.example.com",
        uploadApi: "/api/file/upload",
        checkApi: "/api/file/instant",
        mergeApi: "/api/file/merge",
      },
    });

    expect(FakeUploadWorker.instances).toHaveLength(1);
    const posted = FakeUploadWorker.instances[0].posted[0];
    expect(posted.type).toBe("upload");
    expect(posted.uploadConfig).toMatchObject({
      baseURL: "https://upload.example.com",
      uploadApi: "/api/file/upload",
      checkApi: "/api/file/instant",
      mergeApi: "/api/file/merge",
    });
  });

  it("自定义 mergeApi 原样透传（消费方可改合并路径）", async () => {
    await runUploadTask({
      ...baseOptions(),
      uploadConfig: {
        baseURL: "https://upload.example.com/",
        uploadApi: "/api/file/upload",
        checkApi: "/api/file/instant",
        mergeApi: "/custom/merge-endpoint",
      },
    });

    const posted = FakeUploadWorker.instances[0].posted[0];
    expect(posted.uploadConfig?.mergeApi).toBe("/custom/merge-endpoint");
  });

  it("完成后的 Worker 被回收进空闲池（不泄漏）", async () => {
    await runUploadTask({
      ...baseOptions(),
      uploadConfig: apiConfig,
    });

    await runUploadTask({
      ...baseOptions(),
      uploadConfig: apiConfig,
    });

    // 第二个任务复用空闲 Worker，不新建实例
    expect(FakeUploadWorker.instances).toHaveLength(1);
    disposeUploadWorkerPool();
    expect(FakeUploadWorker.instances[0].terminated).toBe(true);
  });
});

describe("cancelUploadTask（T2.3 Worker CANCEL 协议）", () => {
  beforeEach(() => {
    disposeUploadWorkerPool();
    FakeUploadWorker.instances = [];
    FakeUploadWorker.autoRespond = true;
  });

  afterEach(() => {
    FakeUploadWorker.autoRespond = true;
  });

  it("取消时向对应 Worker 发送 CANCEL，收到 cancelled 后任务以 cancelled 收场", async () => {
    FakeUploadWorker.autoRespond = false; // 挂起任务

    const taskPromise = runUploadTask({
      ...baseOptions(),
      uploadConfig: apiConfig,
    });

    const worker = FakeUploadWorker.instances[0];
    expect(worker).toBeTruthy();

    cancelUploadTask("file-1");

    // Worker 收到 CANCEL 指令
    const cancelMessage = worker.posted.find((m) => m.type === "cancel");
    expect(cancelMessage).toBeTruthy();

    // Worker 回应 cancelled（真实 Worker 中断在途请求后的确认）
    worker.onmessage?.({
      data: { type: "cancelled", fileId: "file-1" },
    } as MessageEvent);

    const result = await taskPromise;
    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
  });

  it("Worker 无 cancelled 响应时 800ms 后 terminate 兜底", async () => {
    vi.useFakeTimers();
    try {
      FakeUploadWorker.autoRespond = false;

      const taskPromise = runUploadTask({
        ...baseOptions(),
        uploadConfig: apiConfig,
      });

      const worker = FakeUploadWorker.instances[0];
      cancelUploadTask("file-1");
      expect(worker.terminated).toBe(false);

      await vi.advanceTimersByTimeAsync(799);
      expect(worker.terminated).toBe(false);

      await vi.advanceTimersByTimeAsync(2);
      expect(worker.terminated).toBe(true);

      // 兜底 terminate 不会让任务 Promise 泄漏：手动触发 error 收尾
      worker.onerror?.({ message: "terminated by cancel fallback" } as Event);
      const result = await taskPromise;
      expect(result.success).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("对不在执行中的 fileId 调用是安全的 no-op", () => {
    expect(() => cancelUploadTask("not-running")).not.toThrow();
  });
});

describe("runUploadTask 消息回调路径（T2.8 补齐）", () => {
  beforeEach(() => {
    disposeUploadWorkerPool();
    FakeUploadWorker.instances = [];
    FakeUploadWorker.autoRespond = true;
  });

  const runWithResponses = async (
    responses: Array<Record<string, unknown>>,
    hooks: {
      onProgress?: (p: number) => void;
      onRetry?: (m: string) => void;
      onDebug?: (m: string, d?: Record<string, unknown>) => void;
    } = {}
  ) => {
    // 拦截 postMessage：不自动回 done，按脚本投递响应序列
    const originalPost = FakeUploadWorker.prototype.postMessage;
    FakeUploadWorker.prototype.postMessage = function patched(
      message: PostedMessage
    ) {
      this.posted.push(message);
      for (const next of responses.splice(0)) {
        this.onmessage?.({ data: next } as MessageEvent);
      }
    };
    try {
      return await runUploadTask({
        ...baseOptions(),
        uploadConfig: apiConfig,
        ...hooks,
      });
    } finally {
      FakeUploadWorker.prototype.postMessage = originalPost;
    }
  };

  it("progress / retry / debug 消息转发到对应回调", async () => {
    const onProgress = vi.fn();
    const onRetry = vi.fn();
    const onDebug = vi.fn();

    const result = await runWithResponses(
      [
        { type: "progress", progress: 42, chunkIndex: 3 },
        { type: "retry", message: "network blip" },
        { type: "debug", message: "chunk md5 done", data: { count: 4 } },
        { type: "done", skipped: false },
      ],
      { onProgress, onRetry, onDebug }
    );

    expect(result.success).toBe(true);
    expect(onProgress).toHaveBeenCalledWith(42);
    expect(onRetry).toHaveBeenCalledWith("network blip");
    expect(onDebug).toHaveBeenCalledWith("chunk md5 done", { count: 4 });
  });

  it("error 消息以 errorMessage 收场", async () => {
    const result = await runWithResponses([
      { type: "error", message: "chunk 3 upload failed", failedChunks: [3] },
    ]);

    expect(result.success).toBe(false);
    expect(result.cancelled).toBeFalsy();
    expect(result.errorMessage).toBe("chunk 3 upload failed");
  });

  it("worker onerror 以错误原因收场且不回收 worker", async () => {
    FakeUploadWorker.autoRespond = false;
    const taskPromise = runUploadTask({
      ...baseOptions(),
      uploadConfig: apiConfig,
    });

    const worker = FakeUploadWorker.instances[0];
    worker.onerror?.({ message: "worker crashed" } as Event);

    const result = await taskPromise;
    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe("worker crashed");
    expect(worker.terminated).toBe(true);
  });

  it("signal 已 aborted 时不创建 worker，直接 cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runUploadTask({
      ...baseOptions(),
      uploadConfig: apiConfig,
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
    expect(FakeUploadWorker.instances).toHaveLength(0);
  });

  it("上传中外部 signal abort：任务 cancelled 且 worker 被销毁", async () => {
    FakeUploadWorker.autoRespond = false;
    const controller = new AbortController();
    const taskPromise = runUploadTask({
      ...baseOptions(),
      uploadConfig: apiConfig,
      signal: controller.signal,
    });

    const worker = FakeUploadWorker.instances[0];
    controller.abort();

    const result = await taskPromise;
    expect(result.cancelled).toBe(true);
    expect(worker.terminated).toBe(true);
  });
});
