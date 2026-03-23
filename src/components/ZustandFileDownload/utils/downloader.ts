import { DownloadFile } from "../types";
import { chunkStore, completeFileStore } from "./storage";

/**
 * 合并文件分片
 */
export const mergeFileChunks = async (file: DownloadFile): Promise<Blob> => {
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
          console.error(`分片 ${i} 不存在，无法合并文件`);
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
    console.error("导出文件失败:", error);
    return false;
  }
};
