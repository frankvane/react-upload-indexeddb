import { DownloadFile } from "../types";
import localforage from "localforage";

// 设置统一的版本号，确保所有实例使用相同的版本
const DB_VERSION = 12;

// 初始化IndexedDB存储
export const fileStore = localforage.createInstance({
  name: "fileDownloadTest",
  storeName: "files",
  description: "用于测试大文件下载存储",
  version: DB_VERSION,
});

// 初始化分片存储
export const chunkStore = localforage.createInstance({
  name: "fileDownloadTest",
  storeName: "chunks",
  description: "用于存储文件分片",
  version: DB_VERSION,
});

// 初始化完整文件存储
export const completeFileStore = localforage.createInstance({
  name: "fileDownloadTest",
  storeName: "completeFiles",
  description: "用于存储合并后的完整文件",
  version: DB_VERSION,
});

// 确保数据库已准备好
export const initializeStorage = async (): Promise<void> => {
  try {
    // 检查每个存储是否可用
    await Promise.all([
      fileStore.ready(),
      chunkStore.ready(),
      completeFileStore.ready(),
    ]);
  } catch (error: any) {
    console.error("存储初始化失败:", error);
    // 如果是版本错误，尝试清除数据并重新初始化
    if (error.name === "VersionError") {
      console.warn("检测到版本不匹配，尝试清除数据并重新初始化");
      try {
        await clearAllStorageData();
        await Promise.all([
          fileStore.ready(),
          chunkStore.ready(),
          completeFileStore.ready(),
        ]);
      } catch (retryError) {
        console.error("存储重新初始化失败:", retryError);
        throw retryError;
      }
    } else {
      throw error;
    }
  }
};

/**
 * 获取已存储的文件列表
 */
export const getStoredFiles = async (): Promise<DownloadFile[]> => {
  try {
    // 确保存储已初始化
    await fileStore.ready();

    const keys = await fileStore.keys();
    const storedFilesData: DownloadFile[] = [];

    for (const key of keys) {
      const fileData = await fileStore.getItem<DownloadFile>(key);
      if (fileData) {
        storedFilesData.push(fileData);
      }
    }

    return storedFilesData;
  } catch (error) {
    console.error("获取已存储文件失败:", error);
    return [];
  }
};

/**
 * 获取存储使用情况
 */
export const getStorageEstimate = async (): Promise<{
  usage: number;
  quota: number;
}> => {
  try {
    if ("storage" in navigator && "estimate" in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    }
    return { usage: 0, quota: 0 };
  } catch (error) {
    console.error("获取存储使用情况失败:", error);
    return { usage: 0, quota: 0 };
  }
};

/**
 * 清除所有存储数据
 */
export const clearAllStorageData = async (): Promise<void> => {
  try {
    await fileStore.clear();
    await chunkStore.clear();
    await completeFileStore.clear();
  } catch (error) {
    console.error("清除存储数据失败:", error);
    throw error;
  }
};
