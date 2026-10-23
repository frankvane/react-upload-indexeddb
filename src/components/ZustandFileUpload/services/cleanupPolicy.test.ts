import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadCleanupPolicy } from "./cleanupPolicy";
import { UploadStatus, type UploadFile } from "../types/upload";

const { mockGetItem, mockSetItem, mockRemoveItem, mockListUploadFiles } =
  vi.hoisted(() => ({
    mockGetItem: vi.fn(),
    mockSetItem: vi.fn(),
    mockRemoveItem: vi.fn(),
    mockListUploadFiles: vi.fn(),
  }));

vi.mock("localforage", () => ({
  default: {
    getItem: mockGetItem,
    setItem: mockSetItem,
    removeItem: mockRemoveItem,
  },
}));

vi.mock("./uploadStorage", () => ({
  listUploadFiles: mockListUploadFiles,
}));

const createFile = (
  id: string,
  status: UploadStatus,
  withFileRef = false
): UploadFile =>
  ({
    id,
    fileName: `${id}.bin`,
    fileSize: 10,
    fileType: "application/octet-stream",
    lastModified: 0,
    status,
    progress: 100,
    createdAt: 0,
    order: 0,
    ...(withFileRef
      ? { fileRef: new File([new Uint8Array(4)], `${id}.bin`) }
      : {}),
  }) as UploadFile;

const createOptions = () => {
  const files = new Map<string, UploadFile>();
  const options = {
    getFiles: () => Array.from(files.values()),
    setFiles: vi.fn((next: UploadFile[]) => {
      files.clear();
      next.forEach((file) => files.set(file.id, file));
    }),
    refreshFiles: vi.fn().mockResolvedValue(undefined),
    setBatchInfo: vi.fn(),
    clearBatchInfo: vi.fn(),
    getCleanupDelay: () => 2,
  };
  return { options, files };
};

describe("UploadCleanupPolicy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockGetItem.mockReset();
    mockSetItem.mockReset();
    mockRemoveItem.mockReset();
    mockListUploadFiles.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("倒计时归零后清理已完成文件并刷新（单 setInterval 触发源）", async () => {
    const { options, files } = createOptions();
    const done = createFile("f-done", UploadStatus.DONE);
    files.set(done.id, done);
    mockGetItem.mockImplementation(async (id: string) => files.get(id));
    mockListUploadFiles.mockResolvedValue([done]);

    const policy = new UploadCleanupPolicy(options);
    // cleanupUploadedFiles：标记待清理集合 + 按 cleanupDelay 启动倒计时
    await policy.cleanupUploadedFiles();

    // 首次 batchInfo 为对象（含初始倒计时）
    expect(options.setBatchInfo.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ countdown: 2 })
    );
    // 随后 startCountdown 写入函数式更新
    const firstUpdater = options.setBatchInfo.mock.calls[1]?.[0];
    expect(typeof firstUpdater).toBe("function");

    await vi.advanceTimersByTimeAsync(1000);
    const tickUpdater = options.setBatchInfo.mock.calls.at(-1)?.[0];
    expect(
      tickUpdater({
        current: 1,
        total: 1,
        queued: 0,
        active: 0,
        completed: 1,
        failed: 0,
        retried: 0,
      })
    ).toEqual(expect.objectContaining({ countdown: 1 }));

    await vi.advanceTimersByTimeAsync(1000);

    expect(mockRemoveItem).toHaveBeenCalledWith("f-done");
    expect(options.refreshFiles).toHaveBeenCalled();

    // 收尾清理 batchInfo（1000ms 尾部定时）
    await vi.advanceTimersByTimeAsync(1000);
    expect(options.clearBatchInfo).toHaveBeenCalled();
  });

  it("dispose 后倒计时不再触发清理", async () => {
    const { options, files } = createOptions();
    const done = createFile("f-dispose", UploadStatus.DONE);
    files.set(done.id, done);
    mockGetItem.mockImplementation(async (id: string) => files.get(id));
    mockListUploadFiles.mockResolvedValue([done]);

    const policy = new UploadCleanupPolicy(options);
    policy.scheduleCleanup(5);
    policy.dispose();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it("ERROR 状态文件在清理时保留，DONE 文件被移除", async () => {
    const { options, files } = createOptions();
    const done = createFile("f-ok", UploadStatus.DONE);
    const errored = createFile("f-err", UploadStatus.ERROR);
    files.set(done.id, done);
    files.set(errored.id, errored);
    mockGetItem.mockImplementation(async (id: string) => files.get(id));
    mockListUploadFiles.mockResolvedValue([done, errored]);

    const policy = new UploadCleanupPolicy(options);
    // 先标记待清理集合（DONE/INSTANT 进入，ERROR 不进入）
    await policy.cleanupUploadedFiles();
    expect(policy.pendingCount()).toBe(1);
    policy.dispose();

    await policy.forceCleanupUI();

    expect(mockRemoveItem).toHaveBeenCalledWith("f-ok");
    expect(mockRemoveItem).not.toHaveBeenCalledWith("f-err");
    // IndexedDB 为准 + refreshFiles 兜底，ERROR 文件不被清理
    expect(options.refreshFiles).toHaveBeenCalled();
  });

  it("forceCleanupUI 立即执行清理且释放已完成文件的 buffer", async () => {
    const { options, files } = createOptions();
    const done = createFile("f-buffer", UploadStatus.DONE, true);
    files.set(done.id, done);
    mockGetItem.mockImplementation(async (id: string) => files.get(id));
    mockListUploadFiles.mockResolvedValue([done]);

    const policy = new UploadCleanupPolicy(options);
    await policy.cleanupUploadedFiles();
    policy.dispose();

    await policy.forceCleanupUI();

    // 记录被从 IndexedDB 移除（T3.1 起不再有 buffer 字段需要剥离）
    expect(mockSetItem).not.toHaveBeenCalledWith(
      "f-buffer",
      expect.anything()
    );
    expect(mockRemoveItem).toHaveBeenCalledWith("f-buffer");
  });

  it("addCompletedFile 只将可清理状态计入待清理集合", async () => {
    const { options } = createOptions();
    mockGetItem.mockImplementation(async (id: string) =>
      id === "f-add" ? createFile("f-add", UploadStatus.DONE) : undefined
    );

    const policy = new UploadCleanupPolicy(options);

    await policy.addCompletedFile("f-add");
    expect(policy.pendingCount()).toBe(1);

    // 不存在的文件为 no-op
    await policy.addCompletedFile("f-missing");
    expect(policy.pendingCount()).toBe(1);

    // INSTANT 同样可清理
    mockGetItem.mockImplementation(async () =>
      createFile("f-instant", UploadStatus.INSTANT)
    );
    await policy.addCompletedFile("f-instant");
    expect(policy.pendingCount()).toBe(2);
  });
});
