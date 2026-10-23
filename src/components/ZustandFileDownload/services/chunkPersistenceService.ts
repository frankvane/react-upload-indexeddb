import { chunkStore } from "../utils";

interface ChunkHealth {
  allChunksExist: boolean;
  missingChunks: number[];
  corruptChunks: number[];
}

export class ChunkPersistenceService {
  async ensureReady() {
    await chunkStore.ready();
  }

  async saveChunkWithRetry(
    fileId: string,
    chunkIndex: number,
    blob: Blob,
    expectedSize: number,
    maxRetries = 3
  ): Promise<boolean> {
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        await this.ensureReady();

        if (!blob || blob.size === 0) {
          throw new Error("invalid chunk blob");
        }

        const chunkId = `${fileId}_chunk_${chunkIndex}`;
        await chunkStore.setItem(chunkId, blob);

        const saved = await chunkStore.getItem<Blob>(chunkId);
        if (!saved || saved.size !== expectedSize) {
          throw new Error("chunk verify failed");
        }

        return true;
      } catch {
        retryCount += 1;
        if (retryCount >= maxRetries) {
          return false;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return false;
  }

  /**
   * 单次游标扫描某个文件的全部已存分片（P1-11）。
   * 旧实现按 index 逐个 getItem：500 分片 = 500 次 IndexedDB 事务；
   * iterate 一次遍历即可拿到全部结果，且能发现超出 totalChunks 的残留分片。
   */
  private async scanFileChunks(fileId: string): Promise<Map<number, Blob>> {
    await this.ensureReady();

    const prefix = `${fileId}_chunk_`;
    const found = new Map<number, Blob>();

    await new Promise<void>((resolve, reject) => {
      chunkStore
        .iterate<Blob, void>((value, key) => {
          if (typeof key === "string" && key.startsWith(prefix)) {
            const index = Number(key.slice(prefix.length));
            if (Number.isInteger(index) && index >= 0) {
              found.set(index, value);
            }
          }
          return undefined;
        })
        .then(resolve, reject);
    });

    return found;
  }

  async getChunkHealth(fileId: string, totalChunks: number): Promise<ChunkHealth> {
    const found = await this.scanFileChunks(fileId);

    const missingChunks: number[] = [];
    const corruptChunks: number[] = [];

    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = found.get(i);
      if (!chunk) {
        missingChunks.push(i);
        continue;
      }

      if (chunk.size === 0) {
        corruptChunks.push(i);
      }
    }

    return {
      allChunksExist: missingChunks.length === 0 && corruptChunks.length === 0,
      missingChunks,
      corruptChunks,
    };
  }

  async removeCorruptChunks(fileId: string, chunkIndexes: number[]) {
    await this.ensureReady();

    for (const chunkIndex of chunkIndexes) {
      await chunkStore.removeItem(`${fileId}_chunk_${chunkIndex}`);
    }
  }

  async getPendingChunks(fileId: string, totalChunks: number): Promise<number[]> {
    const found = await this.scanFileChunks(fileId);

    const pending: number[] = [];
    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = found.get(i);
      if (!chunk || chunk.size === 0) {
        pending.push(i);
      }
    }

    return pending;
  }

  async countDownloadedChunks(fileId: string, totalChunks: number): Promise<number> {
    const found = await this.scanFileChunks(fileId);

    let count = 0;
    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = found.get(i);
      if (chunk && chunk.size > 0) {
        count += 1;
      }
    }

    return count;
  }

  async removeAllChunks(fileId: string, totalChunks: number) {
    const found = await this.scanFileChunks(fileId);

    // 以扫描到的实际分片为准（覆盖 totalChunks 与实际不符的残留）
    const indexes = new Set<number>([
      ...found.keys(),
      ...Array.from({ length: Math.max(0, totalChunks) }, (_, i) => i),
    ]);

    await Promise.all(
      Array.from(indexes, (index) =>
        chunkStore.removeItem(`${fileId}_chunk_${index}`)
      )
    );
  }

  async collectChunks(fileId: string, totalChunks: number) {
    const found = await this.scanFileChunks(fileId);

    const chunks: Blob[] = [];
    const missingChunks: number[] = [];

    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = found.get(i);
      if (!chunk) {
        missingChunks.push(i);
        continue;
      }

      chunks.push(chunk);
    }

    return { chunks, missingChunks };
  }
}
