import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.client", () => ({
  getDownloadFiles: vi.fn(),
}));

import * as apiClient from "../api.client";
import { useDownloadStore } from "./index";
import { DownloadStatus } from "../types/download";
import type { DownloadFile } from "../types";

const listItem = (
  id: string,
  fileSize: number,
  extra: Partial<apiClient.DownloadListItem["metadata"]> = {}
): apiClient.DownloadListItem => ({
  id,
  url: `/api/file/download/${id}`,
  fileName: `${id}.bin`,
  fileSize,
  mimeType: "application/octet-stream",
  metadata: { md5: "a".repeat(32), md5Mode: "full", ...extra },
});

const makeFile = (patch: Partial<DownloadFile>): DownloadFile => ({
  id: "f-existing",
  fileName: "f-existing.bin",
  fileSize: 4 * 1024 * 1024,
  mimeType: "application/octet-stream",
  totalChunks: 8,
  status: DownloadStatus.IDLE,
  ...patch,
});

const STORE_CHUNK_SIZE = 1024 * 1024; // 1MB
const FILE_CHUNK_SIZE = 512 * 1024; // 0.5MB —— 已固化的分片方案

describe("download store fetchDownloadFiles（P1-3）", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useDownloadStore.setState({
      files: [],
      chunkSize: STORE_CHUNK_SIZE,
      lastFetchTime: 0,
      isFetchingFileList: false,
    });
  });

  it("已存在文件沿用原 chunkSize，不被网络自适应后的 store.chunkSize 覆盖", async () => {
    useDownloadStore.setState({
      files: [
        makeFile({
          chunkSize: FILE_CHUNK_SIZE,
          totalChunks: 8,
          downloadedChunks: 3,
          progress: 37.5,
          status: DownloadStatus.DOWNLOADING,
        }),
      ],
    });
    // 网络自适应把默认分片调到 2MB
    useDownloadStore.setState({ chunkSize: 2 * 1024 * 1024 });

    vi.mocked(apiClient.getDownloadFiles).mockResolvedValue([
      listItem("f-existing", 4 * 1024 * 1024),
    ]);

    const result = await useDownloadStore.getState().fetchDownloadFiles({}, true);
    expect(result).toHaveLength(1);
    const file = result[0] as DownloadFile;

    expect(file.chunkSize).toBe(FILE_CHUNK_SIZE);
    expect(file.totalChunks).toBe(8); // 4MB / 0.5MB
    // 进行中的进度 / 状态不能被刷新列表重置
    expect(file.downloadedChunks).toBe(3);
    expect(file.progress).toBe(37.5);
    expect(file.status).toBe(DownloadStatus.DOWNLOADING);
  });

  it("新文件按当前 store.chunkSize 计算分片，并透传 md5/md5Mode", async () => {
    vi.mocked(apiClient.getDownloadFiles).mockResolvedValue([
      listItem("f-new", 4 * 1024 * 1024, { md5Mode: "sample" }),
    ]);

    const result = await useDownloadStore.getState().fetchDownloadFiles({}, true);
    expect(result).toHaveLength(1);
    const file = result[0] as DownloadFile;

    expect(file.chunkSize).toBe(STORE_CHUNK_SIZE);
    expect(file.totalChunks).toBe(4);
    expect(file.downloadedChunks).toBe(0);
    expect(file.status).toBe(DownloadStatus.IDLE);
    expect(file.md5Mode).toBe("sample");
    expect(file.md5).toBe("a".repeat(32));
  });

  it("列表请求失败时不写入半成品状态", async () => {
    vi.mocked(apiClient.getDownloadFiles).mockRejectedValue(new Error("boom"));

    await expect(
      useDownloadStore.getState().fetchDownloadFiles({}, true)
    ).rejects.toThrow("boom");

    const state = useDownloadStore.getState();
    expect(state.files).toEqual([]);
    expect(state.isFetchingFileList).toBe(false);
    expect(state.fetchingFiles).toBe(false);
  });
});
