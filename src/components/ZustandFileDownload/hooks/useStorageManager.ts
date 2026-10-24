import { useCallback, useRef } from "react";

import { message } from "../../../ui";
import { DownloadFile, DownloadStatus } from "../types";
import { useDownloadStore } from "../store";
import { clearAllStorageData, getStorageEstimate } from "../utils";
import { chunkStore, completeFileStore, fileStore } from "../utils";
import { useShallow } from "zustand/react/shallow";
import { debugError } from "./../../../shared/debugLogger";

const STORAGE_CACHE_TIME = 30000;
const STORAGE_CALC_BATCH_SIZE = 50;

const sumInBatches = async (
  keys: string[],
  batchSize: number,
  getSize: (key: string) => Promise<number>
) => {
  let total = 0;
  for (let index = 0; index < keys.length; index += batchSize) {
    const batchKeys = keys.slice(index, index + batchSize);
    const sizes = await Promise.all(batchKeys.map((key) => getSize(key)));
    total += sizes.reduce((sum, size) => sum + size, 0);
  }
  return total;
};

export const useStorageManager = () => {
  const { storageUsage, updateStorageUsage, abortControllers } = useDownloadStore(
    useShallow((state) => ({
      storageUsage: state.storageUsage,
      updateStorageUsage: state.updateStorageUsage,
      abortControllers: state.abortControllers,
    }))
  );

  const lastCalculation = useRef({
    time: 0,
    promise: null as Promise<{ usage: number; quota: number }> | null,
    lastUpdateTime: 0,
  });

  const calculateStorageSize = useCallback(async (): Promise<{
    usage: number;
    quota: number;
  }> => {
    try {
      const storageEstimate = await navigator.storage.estimate();
      const quota = storageEstimate.quota || 0;

      let totalUsage = 0;

      // 元数据（fileStore 中的 JSON 记录）体积小且 stringify 估算偏差大
      // （多字节字符 length≠字节数、不含 IndexedDB 结构开销），不再计入；
      // 统计以 chunk / completeFile 的 Blob.size 实际字节为准（P1-12）。

      await chunkStore.ready();
      const chunkKeys = await chunkStore.keys();
      totalUsage += await sumInBatches(
        chunkKeys,
        STORAGE_CALC_BATCH_SIZE,
        async (key) => {
          const chunk = await chunkStore.getItem<Blob>(key);
          return chunk?.size ?? 0;
        }
      );

      await completeFileStore.ready();
      const completeFileKeys = await completeFileStore.keys();
      totalUsage += await sumInBatches(
        completeFileKeys,
        STORAGE_CALC_BATCH_SIZE,
        async (key) => {
          const completeFile = await completeFileStore.getItem<Blob>(key);
          return completeFile?.size ?? 0;
        }
      );

      return {
        usage: totalUsage,
        quota,
      };
    } catch {
      return getStorageEstimate();
    }
  }, []);

  const getStorageUsage = useCallback(
    async (forceUpdate = false) => {
      try {
        const now = Date.now();

        updateStorageUsage({ isLoading: true });

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
          return;
        }

        lastCalculation.current.time = now;
        lastCalculation.current.promise = calculateStorageSize();

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
      } catch (error) {
        debugError("Failed to calculate storage usage:", error);
        updateStorageUsage({ isLoading: false });
      }
    },
    [updateStorageUsage, calculateStorageSize]
  );

  const triggerStorageUpdate = useCallback(() => {
    void getStorageUsage(false);
  }, [getStorageUsage]);

  const fileSizeCache = useRef<Record<string, { size: number; time: number }>>(
    {}
  );

  const calculateFileSize = useCallback(async (fileId: string): Promise<number> => {
    try {
      const now = Date.now();

      if (
        fileSizeCache.current[fileId] &&
        now - fileSizeCache.current[fileId].time < STORAGE_CACHE_TIME
      ) {
        return fileSizeCache.current[fileId].size;
      }

      const file = await fileStore.getItem<DownloadFile>(fileId);
      if (!file) {
        return 0;
      }

      // 与 calculateStorageSize 一致：只统计 Blob 实际字节，不做 JSON 估算
      let totalSize = 0;

      await chunkStore.ready();
      const fileChunkPrefix = `${fileId}_chunk_`;
      const chunkKeys = (await chunkStore.keys()).filter((key) =>
        key.startsWith(fileChunkPrefix)
      );

      totalSize += await sumInBatches(
        chunkKeys,
        STORAGE_CALC_BATCH_SIZE,
        async (key) => {
          try {
            const chunk = await chunkStore.getItem<Blob>(key);
            return chunk?.size ?? 0;
          } catch {
            return 0;
          }
        }
      );

      try {
        const completeFile = await completeFileStore.getItem<Blob>(fileId);
        if (completeFile) {
          totalSize += completeFile.size;
        }
      } catch {
        // Ignore complete-file read errors and keep partial result.
      }

      fileSizeCache.current[fileId] = {
        size: totalSize,
        time: now,
      };

      return totalSize;
    } catch {
      return 0;
    }
  }, []);

  const clearAllData = useCallback(async () => {
    try {
      await clearAllStorageData();

      for (const controller of Object.values(abortControllers)) {
        controller.abort();
      }

      const { files, setFiles } = useDownloadStore.getState();

      const resetFiles = files.map((file) => ({
        ...file,
        status: DownloadStatus.IDLE,
        progress: 0,
        downloadedChunks: 0,
        error: undefined,
        completedAt: undefined,
      }));

      setFiles(resetFiles);

      await getStorageUsage(true);
      return true;
    } catch {
      message.error("Clear storage data failed");
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
