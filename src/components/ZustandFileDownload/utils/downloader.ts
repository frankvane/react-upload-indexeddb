import { CHUNK_SIZE, DownloadFile } from "../types";
import { chunkStore, completeFileStore } from "./storage";

/**
 * 下载单个分片
 */
export const downloadChunk = async (
  fileId: string,
  url: string,
  chunkIndex: number,
  fileSize: number,
  abortController: AbortController
) => {
  const start = chunkIndex * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);

  try {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${start}-${end}`,
      },
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const blob = await response.blob();
    const chunkId = `${fileId}_chunk_${chunkIndex}`;

    // 存储分片到IndexedDB
    await chunkStore.setItem(chunkId, blob);

    return {
      success: true,
      chunkIndex,
      size: blob.size,
    };
  } catch (err: unknown) {
    // 检查是否是因为中止导致的错误
    const error = err as Error;
    if (error.name === "AbortError") {
      return {
        success: false,
        chunkIndex,
        paused: true,
      };
    }

    console.error(`下载分片 ${chunkIndex} 失败:`, error);
    return {
      success: false,
      chunkIndex,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
};

/**
 * 合并文件分片
 */
export const mergeFileChunks = async (file: DownloadFile): Promise<Blob> => {
  // 获取所有分片
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

  // 合并所有分片
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
    // 从存储中获取完整文件
    let blob = await completeFileStore.getItem<Blob>(file.id);

    // 如果完整文件不存在，尝试从分片重新合并
    if (!blob) {
      // 检查所有分片是否存在
      const totalChunks = file.totalChunks;
      let allChunksExist = true;

      for (let i = 0; i < totalChunks; i++) {
        const chunkId = `${file.id}_chunk_${i}`;
        const chunk = await chunkStore.getItem<Blob>(chunkId);
        if (!chunk) {
          allChunksExist = false;
          console.error(`分片 ${i} 不存在，无法合并文件`);
          break;
        }
      }

      if (!allChunksExist) {
        throw new Error("文件分片不完整，无法导出文件");
      }

      // 从分片合并文件
      blob = await mergeFileChunks(file);

      // 保存合并后的文件到completeFileStore
      await completeFileStore.setItem(file.id, blob);
    }

    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.fileName;
    document.body.appendChild(a);
    a.click();

    // 清理
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    return true;
  } catch (error) {
    console.error("导出文件失败:", error);
    return false;
  }
};
