import { beforeEach, describe, expect, it, vi } from "vitest";
import { UploadStatus, type UploadFile } from "../types/upload";

const iterateMock = vi.fn();
const removeItemMock = vi.fn(async () => undefined);
const setItemMock = vi.fn(async () => undefined);

vi.mock("localforage", () => ({
  default: {
    iterate: (...args: unknown[]) => iterateMock(...args),
    removeItem: (...args: unknown[]) => removeItemMock(...args),
    setItem: (...args: unknown[]) => setItemMock(...args),
  },
}));

const {
  isUploadableStatus,
  listUploadFiles,
  removeUploadFilesByIds,
  recoverInterruptedUploadFiles,
} = await import("./uploadStorage");

const createFile = (
  id: string,
  status: UploadStatus,
  overrides: Partial<UploadFile> = {}
): UploadFile =>
  ({
    id,
    fileName: `${id}.bin`,
    fileSize: 1024,
    fileType: "application/octet-stream",
    lastModified: 1700000000000,
    status,
    progress: 0,
    chunkSize: 1024 * 1024,
    chunkCount: 1,
    uploadedChunks: 0,
    pausedChunks: [],
    createdAt: 1700000000000,
    order: 0,
    ...overrides,
  }) as UploadFile;

describe("uploadStorage（T2.8 补齐）", () => {
  beforeEach(() => {
    iterateMock.mockReset();
    removeItemMock.mockClear();
    setItemMock.mockClear();
  });

  it("isUploadableStatus 覆盖全部分支（既有用例保留）", () => {
    expect(isUploadableStatus(UploadStatus.QUEUED)).toBe(true);
    expect(isUploadableStatus(UploadStatus.PAUSED)).toBe(true);
    expect(isUploadableStatus(UploadStatus.DONE)).toBe(false);
    expect(isUploadableStatus(UploadStatus.INSTANT)).toBe(false);
  });

  it("listUploadFiles 过滤非 UploadFile 记录并按 createdAt 排序", async () => {
    iterateMock.mockImplementation(async (callback) => {
      callback(createFile("b", UploadStatus.DONE, { createdAt: 2 }), "b");
      callback("not-a-file", "junk");
      callback(null, "null-entry");
      callback(createFile("a", UploadStatus.QUEUED, { createdAt: 1 }), "a");
    });

    const files = await listUploadFiles();

    expect(files.map((f) => f.id)).toEqual(["a", "b"]);
    expect(iterateMock).toHaveBeenCalledTimes(1);
  });

  it("removeUploadFilesByIds 空数组直接返回不触存储", async () => {
    await removeUploadFilesByIds([]);
    expect(removeItemMock).not.toHaveBeenCalled();
  });

  it("removeUploadFilesByIds 批量删除", async () => {
    await removeUploadFilesByIds(["a", "b", "c"]);
    expect(removeItemMock).toHaveBeenCalledTimes(3);
    expect(removeItemMock).toHaveBeenCalledWith("a");
    expect(removeItemMock).toHaveBeenCalledWith("c");
  });

  it("recoverInterruptedUploadFiles：有 buffer 的中断任务恢复到 QUEUED", async () => {
    iterateMock.mockImplementation(async (callback) => {
      callback(
        createFile("u1", UploadStatus.UPLOADING, {
          buffer: new ArrayBuffer(8),
        }),
        "u1"
      );
      callback(createFile("done", UploadStatus.DONE), "done");
    });

    const summary = await recoverInterruptedUploadFiles();

    expect(summary).toEqual({
      totalInterrupted: 1,
      recoveredCount: 1,
      missingBufferCount: 0,
    });
    expect(setItemMock).toHaveBeenCalledTimes(1);
    const [, saved] = setItemMock.mock.calls[0];
    expect(saved.status).toBe(UploadStatus.QUEUED);
    expect(saved.errorMessage).toBeUndefined();
  });

  it("recoverInterruptedUploadFiles：buffer 缺失标记 ERROR 且清空进度", async () => {
    iterateMock.mockImplementation(async (callback) => {
      callback(
        createFile("u2", UploadStatus.PREPARING_UPLOAD, { progress: 42 }),
        "u2"
      );
    });

    const summary = await recoverInterruptedUploadFiles();

    expect(summary).toEqual({
      totalInterrupted: 1,
      recoveredCount: 0,
      missingBufferCount: 1,
    });
    const [, saved] = setItemMock.mock.calls[0];
    expect(saved.status).toBe(UploadStatus.ERROR);
    expect(saved.progress).toBe(0);
    expect(saved.errorMessage).toContain("上传中断");
  });

  it("recoverInterruptedUploadFiles：无中断任务时零写入", async () => {
    iterateMock.mockImplementation(async (callback) => {
      callback(createFile("done-1", UploadStatus.DONE), "done-1");
      callback(createFile("instant-1", UploadStatus.INSTANT), "instant-1");
    });

    const summary = await recoverInterruptedUploadFiles();

    expect(summary).toEqual({
      totalInterrupted: 0,
      recoveredCount: 0,
      missingBufferCount: 0,
    });
    expect(setItemMock).not.toHaveBeenCalled();
  });
});
