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

  async getChunkHealth(fileId: string, totalChunks: number): Promise<ChunkHealth> {
    await this.ensureReady();

    const missingChunks: number[] = [];
    const corruptChunks: number[] = [];

    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = await chunkStore.getItem<Blob>(`${fileId}_chunk_${i}`);
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
    await this.ensureReady();

    const pending: number[] = [];
    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = await chunkStore.getItem<Blob>(`${fileId}_chunk_${i}`);
      if (!chunk || chunk.size === 0) {
        pending.push(i);
      }
    }

    return pending;
  }

  async countDownloadedChunks(fileId: string, totalChunks: number): Promise<number> {
    await this.ensureReady();

    let count = 0;
    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = await chunkStore.getItem<Blob>(`${fileId}_chunk_${i}`);
      if (chunk && chunk.size > 0) {
        count += 1;
      }
    }

    return count;
  }

  async removeAllChunks(fileId: string, totalChunks: number) {
    await this.ensureReady();

    for (let i = 0; i < totalChunks; i += 1) {
      await chunkStore.removeItem(`${fileId}_chunk_${i}`);
    }
  }

  async collectChunks(fileId: string, totalChunks: number) {
    await this.ensureReady();

    const chunks: Blob[] = [];
    const missingChunks: number[] = [];

    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = await chunkStore.getItem<Blob>(`${fileId}_chunk_${i}`);
      if (!chunk) {
        missingChunks.push(i);
        continue;
      }

      chunks.push(chunk);
    }

    return { chunks, missingChunks };
  }
}
