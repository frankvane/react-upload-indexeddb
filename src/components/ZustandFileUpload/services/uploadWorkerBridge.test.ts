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
  fileBuffer: new ArrayBuffer(8),
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
