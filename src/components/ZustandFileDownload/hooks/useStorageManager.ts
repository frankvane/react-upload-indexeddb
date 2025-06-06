import { chunkStore, completeFileStore, fileStore } from "../utils";
import { clearAllStorageData, getStorageEstimate } from "../utils";
import { useCallback, useEffect, useRef } from "react";

import { DownloadFile } from "../types";
import { message } from "antd";
import { useDownloadStore } from "../store";

// 计算文件大小的缓存时间（毫秒）
const STORAGE_CACHE_TIME = 30000; // 30秒
// 最小更新间隔（毫秒）
const MIN_UPDATE_INTERVAL = 5000; // 5秒
// 批量更新延迟（毫秒）
const BATCH_UPDATE_DELAY = 2000; // 2秒

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
    pendingUpdate: false, // 是否有待处理的更新
    lastUpdateTime: 0, // 上次实际更新的时间
    updateTimer: null as number | null, // 更新定时器
    batchedUpdates: 0, // 批处理的更新次数
  });

  // 清除定时器
  useEffect(() => {
    return () => {
      if (lastCalculation.current.updateTimer) {
        clearTimeout(lastCalculation.current.updateTimer);
      }
    };
  }, []);

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

        // 如果不是强制更新，且距离上次更新时间太短，则延迟更新
        if (
          !forceUpdate &&
          now - lastCalculation.current.lastUpdateTime < MIN_UPDATE_INTERVAL
        ) {
          // 如果已有待处理的更新，不再重复设置
          if (lastCalculation.current.pendingUpdate) {
            return;
          }

          // 设置待处理标志
          lastCalculation.current.pendingUpdate = true;
          lastCalculation.current.batchedUpdates++;

          // 清除之前的定时器
          if (lastCalculation.current.updateTimer) {
            clearTimeout(lastCalculation.current.updateTimer);
          }

          // 设置新的定时器，延迟执行更新
          lastCalculation.current.updateTimer = setTimeout(() => {
            getStorageUsage(true);
            lastCalculation.current.batchedUpdates = 0;
          }, BATCH_UPDATE_DELAY) as unknown as number;

          return;
        }

        // 如果是强制更新，取消任何待处理的定时器
        if (forceUpdate && lastCalculation.current.updateTimer) {
          clearTimeout(lastCalculation.current.updateTimer);
          lastCalculation.current.updateTimer = null;
        }

        updateStorageUsage({ isLoading: true });

        // 检查是否可以使用缓存的结果
        if (
          !forceUpdate &&
          lastCalculation.current.promise &&
          now - lastCalculation.current.time < STORAGE_CACHE_TIME
        ) {
          const { usage, quota } = await lastCalculation.current.promise;
          const percent = quota > 0 ? (usage / quota) * 100 : 0;

          updateStorageUsage({
            usage,
            quota,
            percent,
            isLoading: false,
            lastUpdated: now,
          });

          lastCalculation.current.lastUpdateTime = now;
          lastCalculation.current.pendingUpdate = false;
          return;
        }

        // 创建新的计算Promise - 使用IndexedDB API计算
        lastCalculation.current.time = now;
        lastCalculation.current.promise = calculateStorageSize();

        // 等待计算结果
        const { usage, quota } = await lastCalculation.current.promise;
        const percent = quota > 0 ? (usage / quota) * 100 : 0;

        updateStorageUsage({
          usage,
          quota,
          percent,
          isLoading: false,
          lastUpdated: now,
        });

        lastCalculation.current.lastUpdateTime = now;
        lastCalculation.current.pendingUpdate = false;
      } catch {
        updateStorageUsage({ isLoading: false });
        lastCalculation.current.pendingUpdate = false;
      }
    },
    [updateStorageUsage, calculateStorageSize]
  );

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

  // 触发存储使用情况更新
  const triggerStorageUpdate = useCallback(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastCalculation.current.lastUpdateTime;

    // 如果距离上次更新时间太短，设置延迟更新
    if (timeSinceLastUpdate < MIN_UPDATE_INTERVAL) {
      // 如果已有待处理的更新，不再重复设置
      if (lastCalculation.current.pendingUpdate) {
        return;
      }

      // 设置延迟更新
      lastCalculation.current.pendingUpdate = true;

      // 清除之前的定时器
      if (lastCalculation.current.updateTimer) {
        clearTimeout(lastCalculation.current.updateTimer);
      }

      // 设置新的定时器
      lastCalculation.current.updateTimer = setTimeout(() => {
        getStorageUsage(true);
      }, MIN_UPDATE_INTERVAL - timeSinceLastUpdate) as unknown as number;
    } else {
      // 直接更新
      getStorageUsage(true);
    }
  }, [getStorageUsage]);

  // 清空所有数据
  const clearAllData = useCallback(async () => {
    try {
      // 清空所有数据
      await clearAllStorageData();

      // 中止所有下载
      for (const controller of Object.values(abortControllers)) {
        controller.abort();
      }

      // 更新存储使用情况
      await getStorageUsage(true);

      // 显示成功消息
      message.success("所有数据已清除");
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
