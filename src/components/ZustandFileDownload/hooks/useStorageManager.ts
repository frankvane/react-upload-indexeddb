import { chunkStore, completeFileStore, fileStore } from "../utils";
import { clearAllStorageData, getStorageEstimate } from "../utils";
import { useCallback, useRef } from "react";

import { DownloadFile } from "../types";
import { DownloadStatus } from "../types";
import { message } from "antd";
import { useDownloadStore } from "../store";

// 计算文件大小的缓存时间（毫秒）
const STORAGE_CACHE_TIME = 5000; // 5秒

/**
 * 存储管理Hook
 */
export const useStorageManager = () => {
  const {
    storageUsage,
    updateStorageUsage,
    resetStorageEstimate,
    updateLocalSizeEstimate,
    abortControllers,
  } = useDownloadStore();

  // 使用ref来存储上次计算的时间和结果
  const lastCalculation = useRef({
    time: 0,
    promise: null as Promise<{ usage: number; quota: number }> | null,
  });

  // 获取存储使用情况
  const getStorageUsage = useCallback(async () => {
    try {
      console.log("开始获取存储使用情况...");
      updateStorageUsage({ isLoading: true });

      // 检查是否可以使用缓存的结果
      const now = Date.now();
      if (
        lastCalculation.current.promise &&
        now - lastCalculation.current.time < STORAGE_CACHE_TIME
      ) {
        console.log("使用缓存的存储使用情况计算结果");
        const { usage, quota } = await lastCalculation.current.promise;
        const percent = quota > 0 ? (usage / quota) * 100 : 0;

        updateStorageUsage({
          usage,
          quota,
          percent,
          isLoading: false,
          lastUpdated: now,
          estimatedUsage: usage,
        });
        return;
      }

      // 创建新的计算Promise
      lastCalculation.current.time = now;
      lastCalculation.current.promise = getStorageEstimate();

      // 等待计算结果
      const { usage, quota } = await lastCalculation.current.promise;
      const percent = quota > 0 ? (usage / quota) * 100 : 0;

      console.log(`存储使用情况: ${usage} / ${quota} (${percent.toFixed(2)}%)`);

      updateStorageUsage({
        usage,
        quota,
        percent,
        isLoading: false,
        lastUpdated: now,
        estimatedUsage: usage, // 重置估计值为实际值
      });
    } catch (error) {
      console.error("获取存储使用情况失败:", error);
      updateStorageUsage({ isLoading: false });
    }
  }, [updateStorageUsage]);

  // 计算文件大小
  const calculateFileSize = useCallback(
    async (fileId: string): Promise<number> => {
      try {
        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) return 0;

        let totalSize = 0;

        // 计算文件元数据大小（粗略估计）
        totalSize += JSON.stringify(file).length;

        // 计算分片大小
        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${fileId}_chunk_${i}`;
          const chunk = await chunkStore.getItem<Blob>(chunkId);
          if (chunk) {
            totalSize += chunk.size;
          }
        }

        // 计算完整文件大小
        const completeFile = await completeFileStore.getItem<Blob>(fileId);
        if (completeFile) {
          totalSize += completeFile.size;
        }

        return totalSize;
      } catch (error) {
        console.error(`计算文件 ${fileId} 大小失败:`, error);
        return 0;
      }
    },
    []
  );

  // 更新本地存储估算
  const updateLocalSize = useCallback(
    async (fileId: string, sizeChange: number) => {
      console.log(`更新本地存储估算: 文件 ${fileId}, 变化 ${sizeChange} 字节`);

      // 如果提供了具体的大小变化，直接使用
      if (sizeChange !== 0) {
        updateLocalSizeEstimate(sizeChange);

        // 如果是较大的文件变化（超过1MB），或者最后一次更新时间超过了缓存时间，重新获取实际使用情况
        const shouldRefresh =
          Math.abs(sizeChange) > 1024 * 1024 ||
          Date.now() - storageUsage.lastUpdated > STORAGE_CACHE_TIME;

        if (shouldRefresh) {
          console.log(`文件大小变化较大或缓存过期，触发存储使用情况更新`);
          // 使用setTimeout延迟更新，避免阻塞UI
          setTimeout(() => {
            getStorageUsage();
          }, 500);
        }
        return;
      }

      // 否则，计算文件实际大小
      const fileSize = await calculateFileSize(fileId);
      console.log(`计算得到文件 ${fileId} 的大小: ${fileSize} 字节`);

      // 更新估计值
      updateLocalSizeEstimate(fileSize);

      // 如果文件较大或最后一次更新时间超过了缓存时间，重新获取实际使用情况
      if (
        fileSize > 1024 * 1024 ||
        Date.now() - storageUsage.lastUpdated > STORAGE_CACHE_TIME
      ) {
        console.log(`文件较大或缓存过期，触发存储使用情况更新`);
        setTimeout(() => {
          getStorageUsage();
        }, 500);
      }
    },
    [
      calculateFileSize,
      getStorageUsage,
      storageUsage.lastUpdated,
      updateLocalSizeEstimate,
    ]
  );

  // 清除所有数据
  const clearAllData = useCallback(async () => {
    try {
      console.log("开始清除所有数据...");
      updateStorageUsage({ isLoading: true });

      // 中止所有下载
      Object.values(abortControllers).forEach((controller) => {
        controller.abort();
      });

      // 清除所有存储数据
      await clearAllStorageData();

      // 重置估算值
      resetStorageEstimate();

      // 重置文件列表状态
      useDownloadStore.setState({
        files: useDownloadStore.getState().files.map((file) => ({
          ...file,
          status: DownloadStatus.IDLE,
          progress: 0,
          downloadedChunks: 0,
          error: undefined,
          completedAt: undefined,
        })),
        storedFiles: [], // 清空已存储文件列表
        abortControllers: {}, // 清空所有AbortController
      });

      message.success("所有数据已清除，文件状态已重置");

      // 强制更新存储使用情况
      lastCalculation.current.time = 0; // 强制重新计算
      await getStorageUsage();

      console.log("所有数据已清除，存储使用情况已更新");
    } catch (error) {
      console.error("清除数据失败:", error);
      message.error("清除数据失败");
      updateStorageUsage({ isLoading: false });
    }
  }, [
    abortControllers,
    getStorageUsage,
    resetStorageEstimate,
    updateStorageUsage,
  ]);

  return {
    storageUsage,
    getStorageUsage,
    updateLocalSize,
    calculateFileSize,
    clearAllData,
  };
};
