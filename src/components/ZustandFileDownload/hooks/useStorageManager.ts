import { DownloadFile, DownloadStatus } from "../types";
import { chunkStore, completeFileStore, fileStore } from "../utils";
import { clearAllStorageData, getStorageEstimate } from "../utils";
import { useCallback, useRef } from "react";

import { message } from "antd";
import { useDownloadStore } from "../store";

// 计算文件大小的缓存时间（毫秒）
const STORAGE_CACHE_TIME = 30000; // 30秒

/**
 * 存储管理Hook
 */
export const useStorageManager = () => {
  const { storageUsage, updateStorageUsage, abortControllers } =
    useDownloadStore();

  // 使用ref来存储上次计算的时间和结果
  const lastCalculation = useRef({
    time: 0,
    promise: null as Promise<{ usage: number; quota: number }> | null,
    lastUpdateTime: 0, // 上次实际更新的时间
  });

  /**
   * 使用IndexedDB API直接计算存储大小
   */
  const calculateStorageSize = useCallback(async (): Promise<{
    usage: number;
    quota: number;
  }> => {
    try {
      // 首先获取浏览器存储配额信息
      const storageEstimate = await navigator.storage.estimate();
      const quota = storageEstimate.quota || 0;

      // 初始化总使用大小
      let totalUsage = 0;

      // 计算文件元数据大小
      await fileStore.ready();
      const fileKeys = await fileStore.keys();
      for (const key of fileKeys) {
        const file = await fileStore.getItem<DownloadFile>(key);
        if (file) {
          // 估计元数据大小
          totalUsage += JSON.stringify(file).length;
        }
      }

      // 计算分片大小
      await chunkStore.ready();
      const chunkKeys = await chunkStore.keys();
      for (const key of chunkKeys) {
        const chunk = await chunkStore.getItem<Blob>(key);
        if (chunk) {
          totalUsage += chunk.size;
        }
      }

      // 计算完整文件大小
      await completeFileStore.ready();
      const completeFileKeys = await completeFileStore.keys();
      for (const key of completeFileKeys) {
        const completeFile = await completeFileStore.getItem<Blob>(key);
        if (completeFile) {
          totalUsage += completeFile.size;
        }
      }

      return {
        usage: totalUsage,
        quota: quota,
      };
    } catch {
      // 失败时回退到浏览器API
      return getStorageEstimate();
    }
  }, []);

  // 获取存储使用情况
  const getStorageUsage = useCallback(
    async (forceUpdate = false) => {
      try {
        const now = Date.now();

        // 设置loading状态
        updateStorageUsage({ isLoading: true });

        // 如果不是强制更新且有缓存，尝试使用缓存
        if (
          !forceUpdate &&
          lastCalculation.current.promise &&
          now - lastCalculation.current.time < STORAGE_CACHE_TIME
        ) {
          const { usage, quota } = await lastCalculation.current.promise;
          const percent = quota > 0 ? (usage / quota) * 100 : 0;

          // 更新UI状态
          updateStorageUsage({
            usage,
            quota,
            percent,
            isLoading: false,
            lastUpdated: now,
          });

          lastCalculation.current.lastUpdateTime = now;
          return;
        }

        // 强制更新或没有缓存时，直接进行计算
        lastCalculation.current.time = now;
        lastCalculation.current.promise = calculateStorageSize();

        // 等待计算结果
        const { usage, quota } = await lastCalculation.current.promise;
        const percent = quota > 0 ? (usage / quota) * 100 : 0;

        // 更新UI状态
        updateStorageUsage({
          usage,
          quota,
          percent,
          isLoading: false,
          lastUpdated: now,
        });

        lastCalculation.current.lastUpdateTime = now;
      } catch (error) {
        console.error("计算存储使用情况失败:", error);
        updateStorageUsage({ isLoading: false });
      }
    },
    [updateStorageUsage, calculateStorageSize]
  );

  // 触发存储使用情况更新 - 简化版本
  const triggerStorageUpdate = useCallback(() => {
    // 直接调用getStorageUsage
    getStorageUsage(false);
  }, [getStorageUsage]);

  // 计算文件大小 - 使用缓存优化
  const fileSizeCache = useRef<Record<string, { size: number; time: number }>>(
    {}
  );

  const calculateFileSize = useCallback(
    async (fileId: string): Promise<number> => {
      try {
        const now = Date.now();

        // 检查缓存
        if (
          fileSizeCache.current[fileId] &&
          now - fileSizeCache.current[fileId].time < STORAGE_CACHE_TIME
        ) {
          return fileSizeCache.current[fileId].size;
        }

        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) return 0;

        let totalSize = 0;

        // 计算文件元数据大小（粗略估计）
        totalSize += JSON.stringify(file).length;

        // 计算分片大小 - 使用更精确的方式
        await chunkStore.ready();
        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${fileId}_chunk_${i}`;
          try {
            const chunk = await chunkStore.getItem<Blob>(chunkId);
            if (chunk) {
              totalSize += chunk.size;
            }
          } catch {
            // 继续处理其他分片
          }
        }

        // 计算完整文件大小
        try {
          const completeFile = await completeFileStore.getItem<Blob>(fileId);
          if (completeFile) {
            totalSize += completeFile.size;
          }
        } catch {
          // 继续处理
        }

        // 更新缓存
        fileSizeCache.current[fileId] = {
          size: totalSize,
          time: now,
        };

        return totalSize;
      } catch {
        return 0;
      }
    },
    []
  );

  // 清空所有数据
  const clearAllData = useCallback(async () => {
    try {
      // 清空所有数据
      await clearAllStorageData();

      // 中止所有下载
      for (const controller of Object.values(abortControllers)) {
        controller.abort();
      }

      // 获取当前文件列表
      const { files, setFiles } = useDownloadStore.getState();

      // 重置所有文件状态为等待下载模式
      const resetFiles = files.map((file) => ({
        ...file,
        status: DownloadStatus.IDLE,
        progress: 0,
        downloadedChunks: 0,
        error: undefined,
        completedAt: undefined,
      }));

      // 更新文件列表状态
      setFiles(resetFiles);

      // 更新存储使用情况
      await getStorageUsage(true);

      // 显示成功消息
      // message.success("所有数据已清除");
      return true;
    } catch {
      // 显示错误消息
      message.error("清除数据失败");
      return false;
    }
  }, [getStorageUsage, abortControllers]);

  return {
    storageUsage,
    getStorageUsage,
    calculateFileSize,
    clearAllData,
    triggerStorageUpdate,
  };
};
