import { UploadFile } from "../types/upload";
import localforage from "localforage";

// 字节大小转换为可读格式
export function ByteConvert(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + " KB";
  else if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + " MB";
  else return (bytes / 1073741824).toFixed(2) + " GB";
}

// 获取IndexedDB使用量统计信息
export async function getStorageStats(): Promise<{
  totalFiles: number;
  totalSize: number;
  formattedSize: string;
  filesWithBuffer: number;
  filesWithoutBuffer: number;
  averageFileSize: number;
  formattedAvgSize: string;
}> {
  let totalFiles = 0;
  let filesWithBuffer = 0;
  let filesWithoutBuffer = 0;
  let totalSize = 0;

  try {
    const keys = await localforage.keys();
    totalFiles = keys.length;

    for (const key of keys) {
      const file = await localforage.getItem<UploadFile>(key);
      if (file) {
        // 计算文件本身的大小（元数据）
        const metadataSize = JSON.stringify(file).length * 2; // 每个字符约占2字节

        // 计算文件buffer的大小（如果存在）
        const bufferSize = file.buffer ? file.buffer.byteLength : 0;

        // 统计文件信息
        if (file.buffer) {
          filesWithBuffer++;
        } else {
          filesWithoutBuffer++;
        }

        // 累加总大小
        totalSize += metadataSize + bufferSize;
      }
    }

    const averageFileSize = totalFiles > 0 ? totalSize / totalFiles : 0;

    return {
      totalFiles,
      totalSize,
      formattedSize: ByteConvert(totalSize),
      filesWithBuffer,
      filesWithoutBuffer,
      averageFileSize,
      formattedAvgSize: ByteConvert(averageFileSize),
    };
  } catch (error) {
    console.error("获取存储统计信息时出错:", error);
    return {
      totalFiles: 0,
      totalSize: 0,
      formattedSize: "0 B",
      filesWithBuffer: 0,
      filesWithoutBuffer: 0,
      averageFileSize: 0,
      formattedAvgSize: "0 B",
    };
  }
}
