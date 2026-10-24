import { DownloadFile } from "../types";
import { chunkStore, completeFileStore } from "./storage";
import { debugError } from "./../../../shared/debugLogger";
import SparkMD5 from "spark-md5";

/**
 * 合并文件分片（主线程回退路径，无 Worker 环境时使用）。
 * expectedMd5 提供时增量计算合并后真实全量 md5 并比对（F5 合并终检）。
 */
export const mergeFileChunks = async (
  file: DownloadFile,
  expectedMd5?: string
): Promise<Blob> => {
  const totalChunks = file.totalChunks;
  const chunkKeys = Array.from(
    { length: totalChunks },
    (_, i) => `${file.id}_chunk_${i}`
  );
  const blobs: Blob[] = [];

  for (const key of chunkKeys) {
    const chunk = await chunkStore.getItem<Blob>(key);
    if (!chunk) {
      throw new Error(`分片 ${key} 不存在，无法合并文件`);
    }
    blobs.push(chunk);
  }

  if (expectedMd5) {
    const spark = new SparkMD5.ArrayBuffer();
    for (const chunk of blobs) {
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

  return new Blob(blobs, {
    type: file.mimeType,
  });
};

/**
 * 导出文件（下载到本地）
 */
export const exportFileToLocal = async (
  file: DownloadFile
): Promise<boolean> => {
  try {
    let blob = await completeFileStore.getItem<Blob>(file.id);

    if (!blob) {
      const totalChunks = file.totalChunks;
      let allChunksExist = true;

      for (let i = 0; i < totalChunks; i++) {
        const chunkId = `${file.id}_chunk_${i}`;
        const chunk = await chunkStore.getItem<Blob>(chunkId);
        if (!chunk) {
          allChunksExist = false;
          debugError(`分片 ${i} 不存在，无法合并文件`);
          break;
        }
      }

      if (!allChunksExist) {
        throw new Error("文件分片不完整，无法导出文件");
      }

      blob = await mergeFileChunks(file);
      await completeFileStore.setItem(file.id, blob);
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.fileName;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    return true;
  } catch (error) {
    debugError("导出文件失败:", error);
    return false;
  }
};
