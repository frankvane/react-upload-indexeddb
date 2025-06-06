import { chunkStore, completeFileStore, fileStore } from "../utils";
import { clearAllStorageData, getStorageEstimate } from "../utils";
import { useCallback, useEffect, useRef } from "react";

import { DownloadFile } from "../types";
import { DownloadStatus } from "../types";
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
      console.log("开始使用IndexedDB API计算存储大小...");

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

      console.log(`IndexedDB存储大小计算完成: ${totalUsage} / ${quota} 字节`);

      return {
        usage: totalUsage,
        quota: quota,
      };
    } catch (error) {
      console.error("计算存储大小失败:", error);
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
            console.log(
              `执行批量延迟更新，合并了${lastCalculation.current.batchedUpdates}次更新请求`
            );
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

        console.log("开始获取存储使用情况...");
        updateStorageUsage({ isLoading: true });

        // 检查是否可以使用缓存的结果
        if (
          !forceUpdate &&
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

        console.log(
          `存储使用情况: ${usage} / ${quota} (${percent.toFixed(2)}%)`
        );

        updateStorageUsage({
          usage,
          quota,
          percent,
          isLoading: false,
          lastUpdated: now,
          estimatedUsage: usage, // 重置估计值为实际值
        });

        lastCalculation.current.lastUpdateTime = now;
        lastCalculation.current.pendingUpdate = false;
      } catch (error) {
        console.error("获取存储使用情况失败:", error);
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
          console.log(`使用缓存的文件大小: ${fileId}`);
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
          } catch (e) {
            console.warn(`获取分片 ${chunkId} 失败:`, e);
            // 继续处理其他分片
          }
        }

        // 计算完整文件大小
        try {
          await completeFileStore.ready();
          const completeFile = await completeFileStore.getItem<Blob>(fileId);
          if (completeFile) {
            totalSize += completeFile.size;
          }
        } catch (e) {
          console.warn(`获取完整文件 ${fileId} 失败:`, e);
        }

        // 更新缓存
        fileSizeCache.current[fileId] = { size: totalSize, time: now };

        return totalSize;
      } catch (error) {
        console.error(`计算文件 ${fileId} 大小失败:`, error);
        return 0;
      }
    },
    []
  );

  // 更新本地存储估算 - 使用批量更新
  const pendingUpdates = useRef<Record<string, number>>({});
  const updateTimer = useRef<number | null>(null);

  const updateLocalSize = useCallback(
    async (fileId: string, sizeChange: number) => {
      console.log(`更新本地存储估算: 文件 ${fileId}, 变化 ${sizeChange} 字节`);

      // 如果提供了具体的大小变化，添加到待处理更新
      if (sizeChange !== 0) {
        pendingUpdates.current[fileId] =
          (pendingUpdates.current[fileId] || 0) + sizeChange;

        // 如果已有定时器，不再重复设置
        if (updateTimer.current) return;

        // 设置定时器，延迟执行批量更新
        updateTimer.current = setTimeout(() => {
          const totalChange = Object.values(pendingUpdates.current).reduce(
            (sum, change) => sum + change,
            0
          );
          console.log(`执行批量存储估算更新，总变化: ${totalChange} 字节`);

          updateLocalSizeEstimate(totalChange);
          pendingUpdates.current = {};
          updateTimer.current = null;

          // 如果变化较大，触发一次实际计算
          if (Math.abs(totalChange) > 1024 * 1024) {
            // 变化超过1MB
            setTimeout(() => {
              getStorageUsage(true);
            }, 500);
          }
        }, BATCH_UPDATE_DELAY) as unknown as number;

        return;
      }

      // 否则，计算文件实际大小
      const fileSize = await calculateFileSize(fileId);
      console.log(`计算得到文件 ${fileId} 的大小: ${fileSize} 字节`);

      // 更新估计值
      updateLocalSizeEstimate(fileSize);
    },
    [calculateFileSize, updateLocalSizeEstimate, getStorageUsage]
  );

  // 文件操作完成后触发存储使用情况更新 - 减少更新频率
  const triggerStorageUpdate = useCallback(() => {
    const now = Date.now();

    // 如果距离上次更新时间足够长，直接更新
    if (
      now - lastCalculation.current.lastUpdateTime >
      MIN_UPDATE_INTERVAL * 2
    ) {
      console.log("文件操作完成，触发存储使用情况更新");
      getStorageUsage(true); // 强制更新
    } else {
      // 否则设置为待处理状态，延迟更新
      if (!lastCalculation.current.pendingUpdate) {
        console.log("文件操作完成，但距离上次更新时间太短，设置延迟更新");
        lastCalculation.current.pendingUpdate = true;

        // 清除之前的定时器
        if (lastCalculation.current.updateTimer) {
          clearTimeout(lastCalculation.current.updateTimer);
        }

        // 设置新的定时器
        lastCalculation.current.updateTimer = setTimeout(() => {
          if (lastCalculation.current.pendingUpdate) {
            console.log("执行延迟的存储使用情况更新");
            getStorageUsage(true);
          }
        }, MIN_UPDATE_INTERVAL) as unknown as number;
      }
    }
  }, [getStorageUsage]);

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
        abortControllers: {}, // 清空所有AbortController
      });

      // 清除缓存
      fileSizeCache.current = {};
      pendingUpdates.current = {};
      if (updateTimer.current) {
        clearTimeout(updateTimer.current);
        updateTimer.current = null;
      }

      message.success("所有数据已清除，文件状态已重置");

      // 强制更新存储使用情况
      lastCalculation.current.time = 0; // 强制重新计算
      await getStorageUsage(true);

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
    triggerStorageUpdate,
  };
};
