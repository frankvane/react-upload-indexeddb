import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChunkPersistenceService } from "./chunkPersistenceService";
import { chunkStore } from "../utils";

// jsdom 的 Blob 经 fake-indexeddb structuredClone 会退化为普通对象（size 丢失），
// 测试数据统一用 Node 原生 Blob，与浏览器行为一致。
const makeChunkBlob = (size = 16) => new NodeBlob([new Uint8Array(size)]);

const TOTAL_CHUNKS = 500;
const DOWNLOADED = 250;

const seedChunks = async (fileId: string) => {
  await chunkStore.ready();
  for (let i = 0; i < DOWNLOADED; i += 1) {
    await chunkStore.setItem(`${fileId}_chunk_${i}`, makeChunkBlob());
  }
};

describe("ChunkPersistenceService 单游标扫描（T2.5 / P1-11）", () => {
  const service = new ChunkPersistenceService();
  const fileId = "storage-perf-file";

  beforeEach(async () => {
    await chunkStore.ready();
    await chunkStore.clear();
    await seedChunks(fileId);
  });

  it("getPendingChunks：500 分片只发起 1 次 iterate 游标", async () => {
    const iterateSpy = vi.spyOn(chunkStore, "iterate");

    const pending = await service.getPendingChunks(fileId, TOTAL_CHUNKS);

    expect(iterateSpy).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(TOTAL_CHUNKS - DOWNLOADED);
    expect(pending[0]).toBe(DOWNLOADED);
    expect(pending.at(-1)).toBe(TOTAL_CHUNKS - 1);
    iterateSpy.mockRestore();
  });

  it("countDownloadedChunks 与 collectChunks 同样只走一次游标", async () => {
    const iterateSpy = vi.spyOn(chunkStore, "iterate");

    const count = await service.countDownloadedChunks(fileId, TOTAL_CHUNKS);
    expect(count).toBe(DOWNLOADED);
    expect(iterateSpy).toHaveBeenCalledTimes(1);

    const { chunks, missingChunks } = await service.collectChunks(
      fileId,
      TOTAL_CHUNKS
    );
    expect(chunks).toHaveLength(DOWNLOADED);
    expect(missingChunks).toHaveLength(TOTAL_CHUNKS - DOWNLOADED);
    expect(iterateSpy).toHaveBeenCalledTimes(2);
    iterateSpy.mockRestore();
  });

  it("getChunkHealth 识别缺失分片（单游标）", async () => {
    const iterateSpy = vi.spyOn(chunkStore, "iterate");
    const health = await service.getChunkHealth(fileId, TOTAL_CHUNKS);

    expect(iterateSpy).toHaveBeenCalledTimes(1);
    expect(health.allChunksExist).toBe(false);
    expect(health.missingChunks).toHaveLength(TOTAL_CHUNKS - DOWNLOADED);
    iterateSpy.mockRestore();
  });

  it("removeAllChunks 清空后再次扫描为空（合并后清理，P1-12）", async () => {
    await service.removeAllChunks(fileId, TOTAL_CHUNKS);

    const pending = await service.getPendingChunks(fileId, TOTAL_CHUNKS);
    expect(pending).toHaveLength(TOTAL_CHUNKS);

    const count = await service.countDownloadedChunks(fileId, TOTAL_CHUNKS);
    expect(count).toBe(0);
  });

  it("多文件分片互不干扰（前缀隔离）", async () => {
    await chunkStore.setItem("other-file_chunk_0", makeChunkBlob());

    const count = await service.countDownloadedChunks(fileId, TOTAL_CHUNKS);
    expect(count).toBe(DOWNLOADED);
  });
});
