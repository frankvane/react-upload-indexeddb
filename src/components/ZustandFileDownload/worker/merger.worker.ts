import SparkMD5 from "spark-md5";
import { debugError } from "./../../../shared/debugLogger";
const ctx: Worker = self as unknown as Worker;
type WorkerEnvelope = { type: string; payload: unknown };

ctx.addEventListener("message", async (event: MessageEvent<WorkerEnvelope>) => {
  const { type, payload } = event.data;

  if (type === "MERGE_FILE") {
    await mergeFileChunks(
      payload as {
        fileId: string;
        totalChunks: number;
        mimeType: string;
        chunks: Blob[];
        /** 服务端返回的权威全量 md5；提供时合并后增量计算并比对，不一致即失败（F5） */
        expectedMd5?: string;
      }
    );
  }
});

async function mergeFileChunks(payload: {
  fileId: string;
  totalChunks: number;
  mimeType: string;
  chunks: Blob[];
  expectedMd5?: string;
}) {
  const { fileId, totalChunks, mimeType, chunks, expectedMd5 } = payload;

  try {
    if (chunks.length !== totalChunks) {
      throw new Error(
        `Chunk count mismatch: expected ${totalChunks}, actual ${chunks.length}`
      );
    }

    // F5 合并终检：增量计算合并后真实全量 md5（复用 spark-md5），与列表 md5 比对。
    // 服务端 S2 已保证存储的 md5 为真实全量哈希，因此任意分片在下载/传输中被截断、
    // 缓存替换或服务端内容变更，都会在此处被检出，用户拿到失败提示而非损坏文件。
    // expectedMd5 缺失（旧版服务端未返回）时跳过，保持向后兼容。
    if (expectedMd5) {
      const spark = new SparkMD5.ArrayBuffer();
      for (const chunk of chunks) {
        const buf = await chunk.arrayBuffer();
        spark.append(buf);
      }
      const actualMd5 = spark.end();
      if (actualMd5 !== expectedMd5) {
        throw new Error(
          `file md5 verification failed: expected ${expectedMd5}, actual ${actualMd5}`
        );
      }
    }

    const mergedBlob = new Blob(chunks, { type: mimeType });

    ctx.postMessage({
      type: "MERGE_COMPLETE",
      payload: {
        fileId,
        blob: mergedBlob,
        size: mergedBlob.size,
      },
    });
  } catch (err) {
    const error = err as Error;
    debugError("Failed to merge file:", error);

    ctx.postMessage({
      type: "ERROR",
      payload: {
        fileId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

export {};
