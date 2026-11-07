import { describe, expect, it } from "vitest";

import {
  buildStartDownloadMessage,
  buildUpdateConcurrencyMessage,
  normalizeDownloadFile,
} from "./downloadPolicy";
import type { DownloadFile } from "../types";
import { DownloadStatus } from "../types/download";

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

const makeFile = (patch: Partial<DownloadFile> = {}): DownloadFile => ({
  id: "f-1",
  fileName: "demo.bin",
  fileSize: 10 * 1024 * 1024,
  mimeType: "application/octet-stream",
  totalChunks: 0,
  status: DownloadStatus.IDLE,
  ...patch,
});

describe("normalizeDownloadFile（P1-3 归一化）", () => {
  it("已有 chunkSize 时以文件自身为准，并重算 totalChunks", () => {
    const { normalizedFile, finalChunkSize, calculatedTotalChunks, filePatch } =
      normalizeDownloadFile(makeFile({ chunkSize: 1024 * 1024, totalChunks: 999 }), 2 * 1024 * 1024);

    expect(finalChunkSize).toBe(1024 * 1024);
    expect(calculatedTotalChunks).toBe(10);
    expect(filePatch).toEqual({ totalChunks: 10 });
    expect(normalizedFile.chunkSize).toBe(1024 * 1024);
    expect(normalizedFile.totalChunks).toBe(10);
  });

  it("无 chunkSize 时回落到 store 分片大小", () => {
    const { finalChunkSize, filePatch } = normalizeDownloadFile(
      makeFile(),
      2 * 1024 * 1024
    );

    expect(finalChunkSize).toBe(2 * 1024 * 1024);
    expect(filePatch).toEqual({ chunkSize: 2 * 1024 * 1024, totalChunks: 5 });
  });

  it("store 分片大小缺失时回落到 5MB 默认值", () => {
    const { finalChunkSize } = normalizeDownloadFile(makeFile(), 0);
    expect(finalChunkSize).toBe(DEFAULT_CHUNK_SIZE);
  });

  it("参数完全一致时不产生 patch，直接复用原对象", () => {
    const file = makeFile({ chunkSize: 2 * 1024 * 1024, totalChunks: 5 });
    const { normalizedFile, filePatch } = normalizeDownloadFile(file, 1024 * 1024);

    expect(filePatch).toEqual({});
    expect(normalizedFile).toBe(file);
  });
});

describe("worker 消息构造", () => {
  it("START_DOWNLOAD 携带归一化分片参数与鉴权头", () => {
    const message = buildStartDownloadMessage({
      fileId: "f-1",
      fileSize: 10 * 1024 * 1024,
      finalChunkSize: 1024 * 1024,
      totalChunks: 10,
      pendingChunks: [3, 7],
      fileConcurrency: 2,
      chunkConcurrency: 4,
      authHeaders: { Authorization: "Bearer t" },
      withCredentials: true,
      allowedHosts: ["api.example.com"],
    });

    expect(message.type).toBe("START_DOWNLOAD");
    expect(message.payload).toMatchObject({
      fileId: "f-1",
      fileSize: 10 * 1024 * 1024,
      chunkSize: 1024 * 1024,
      totalChunks: 10,
      pendingChunks: [3, 7],
      fileConcurrency: 2,
      chunkConcurrency: 4,
      authHeaders: { Authorization: "Bearer t" },
      withCredentials: true,
      allowedHosts: ["api.example.com"],
    });
    expect(message.payload.url).toContain("/api/file/download/f-1");
  });

  it("未显式传 allowedHosts 时由 baseURL 推导白名单（F3）", () => {
    const message = buildStartDownloadMessage({
      fileId: "f-2",
      fileSize: 1024,
      finalChunkSize: 1024,
      totalChunks: 1,
      pendingChunks: [0],
      fileConcurrency: 1,
      chunkConcurrency: 1,
      authHeaders: {},
      withCredentials: false,
      baseURL: "https://files.example.com",
    });

    expect(message.payload.allowedHosts).toEqual(["files.example.com"]);
  });

  it("UPDATE_CONCURRENCY 透传并发参数", () => {
    expect(buildUpdateConcurrencyMessage(3, 6)).toEqual({
      type: "UPDATE_CONCURRENCY",
      payload: { fileConcurrency: 3, chunkConcurrency: 6 },
    });
  });
});
