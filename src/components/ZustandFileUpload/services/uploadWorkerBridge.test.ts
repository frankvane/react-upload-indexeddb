import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UploadFile } from "../types/upload";

interface PostedMessage {
  type: string;
  uploadConfig?: Record<string, unknown>;
}

class FakeUploadWorker {
  static instances: FakeUploadWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  posted: PostedMessage[] = [];
  terminated = false;

  constructor() {
    FakeUploadWorker.instances.push(this);
  }

  postMessage(message: PostedMessage) {
    this.posted.push(message);
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

const { runUploadTask, disposeUploadWorkerPool } = await import(
  "./uploadWorkerBridge"
);

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
      uploadConfig: {
        baseURL: "",
        uploadApi: "/api/file/upload",
        checkApi: "/api/file/instant",
        mergeApi: "/api/file/merge",
      },
    });

    await runUploadTask({
      ...baseOptions(),
      uploadConfig: {
        baseURL: "",
        uploadApi: "/api/file/upload",
        checkApi: "/api/file/instant",
        mergeApi: "/api/file/merge",
      },
    });

    // 第二个任务复用空闲 Worker，不新建实例
    expect(FakeUploadWorker.instances).toHaveLength(1);
    disposeUploadWorkerPool();
    expect(FakeUploadWorker.instances[0].terminated).toBe(true);
  });
});
