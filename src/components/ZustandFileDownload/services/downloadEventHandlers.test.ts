import { beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadStatus, type DownloadFile } from "../types";

const completeFileStoreMock = vi.hoisted(() => ({
  ready: vi.fn(async () => undefined),
  setItem: vi.fn(async () => undefined),
}));
const fileStoreMock = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(async () => undefined),
}));

vi.mock("../utils", () => ({
  completeFileStore: completeFileStoreMock,
  fileStore: fileStoreMock,
}));

vi.mock("antd", () => ({
  message: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const { createDownloadEventHandlers } = await import("./downloadEventHandlers");

const createFile = (overrides: Partial<DownloadFile> = {}): DownloadFile =>
  ({
    id: "dl-1",
    fileName: "movie.mp4",
    fileSize: 1024,
    mimeType: "video/mp4",
    totalChunks: 4,
    downloadedChunks: 4,
    progress: 100,
    status: DownloadStatus.DOWNLOADING,
    createdAt: 1700000000000,
    ...overrides,
  }) as DownloadFile;

const createHandlers = () => {
  const chunkService = {
    getChunkHealth: vi.fn(),
    removeCorruptChunks: vi.fn(async () => undefined),
    removeAllChunks: vi.fn(async () => undefined),
    countDownloadedChunks: vi.fn(),
  };
  const mergeService = {
    markCompleted: vi.fn(async () => undefined),
    markPausedForMissingChunks: vi.fn(async () => undefined),
  };
  const removeProcessing = vi.fn();
  const updateFile = vi.fn();

  const handlers = createDownloadEventHandlers({
    chunkService: chunkService as never,
    mergeService: mergeService as never,
    removeProcessing,
    updateFile,
  });

  return { handlers, chunkService, mergeService, removeProcessing, updateFile };
};

describe("downloadEventHandlers（T2.5/T2.8）", () => {
  beforeEach(() => {
    completeFileStoreMock.ready.mockClear();
    completeFileStoreMock.setItem.mockClear();
    fileStoreMock.getItem.mockReset();
    fileStoreMock.setItem.mockClear();
  });

  it("handleMergeComplete：写入完整文件、标记完成并移除处理态（P1-12）", async () => {
    const { handlers, mergeService, removeProcessing } = createHandlers();
    const file = createFile();
    fileStoreMock.getItem.mockResolvedValue(file);
    const blob = new Blob([new Uint8Array(8)]);

    await handlers.handleMergeComplete({ fileId: "dl-1", blob });

    expect(completeFileStoreMock.ready).toHaveBeenCalled();
    expect(completeFileStoreMock.setItem).toHaveBeenCalledWith("dl-1", blob);
    expect(mergeService.markCompleted).toHaveBeenCalledWith(file);
    // 分片清理由 useFileDownloaderController 的合并完成路径负责（T2.5）
    expect(removeProcessing).toHaveBeenCalledWith("dl-1");
  });

  it("handleDownloadComplete：分片缺失时标记暂停并清理损坏分片", async () => {
    const { handlers, chunkService, mergeService, removeProcessing } =
      createHandlers();
    const file = createFile({ status: DownloadStatus.DOWNLOADING });
    fileStoreMock.getItem.mockResolvedValue(file);
    chunkService.getChunkHealth.mockResolvedValue({
      allChunksExist: false,
      missingChunks: [3],
      corruptChunks: [2],
    });

    await handlers.handleDownloadComplete({ fileId: "dl-1" });

    expect(chunkService.removeCorruptChunks).toHaveBeenCalledWith("dl-1", [2]);
    expect(mergeService.markPausedForMissingChunks).toHaveBeenCalledWith(
      file,
      [3, 2],
      expect.stringContaining("分片缺失")
    );
    expect(mergeService.markCompleted).not.toHaveBeenCalled();
    expect(removeProcessing).toHaveBeenCalledWith("dl-1");
  });

  it("handleDownloadComplete：分片齐全时直接标记完成并异步清理分片", async () => {
    const { handlers, chunkService, mergeService } = createHandlers();
    const file = createFile();
    fileStoreMock.getItem.mockResolvedValue(file);
    chunkService.getChunkHealth.mockResolvedValue({
      allChunksExist: true,
      missingChunks: [],
      corruptChunks: [],
    });

    await handlers.handleDownloadComplete({ fileId: "dl-1" });

    expect(mergeService.markCompleted).toHaveBeenCalledWith(file);
    expect(chunkService.removeAllChunks).toHaveBeenCalledWith("dl-1", 4);
  });

  it("handleDownloadPaused：按已下载分片重算进度并持久化", async () => {
    const { handlers, chunkService, updateFile } = createHandlers();
    const file = createFile({ totalChunks: 4, downloadedChunks: 0, progress: 0 });
    fileStoreMock.getItem.mockResolvedValue(file);
    chunkService.countDownloadedChunks.mockResolvedValue(3);

    await handlers.handleDownloadPaused({ fileId: "dl-1" });

    expect(updateFile).toHaveBeenCalledWith(
      "dl-1",
      expect.objectContaining({
        status: DownloadStatus.PAUSED,
        progress: 75,
        downloadedChunks: 3,
      })
    );
  });

  it("handleDownloadError：置 ERROR 并透传原因", async () => {
    const { handlers, updateFile, removeProcessing } = createHandlers();

    handlers.handleDownloadError({ fileId: "dl-1", error: "network down" });

    expect(updateFile).toHaveBeenCalledWith(
      "dl-1",
      expect.objectContaining({
        status: DownloadStatus.ERROR,
        error: "network down",
      })
    );
    expect(removeProcessing).toHaveBeenCalledWith("dl-1");
  });
});
