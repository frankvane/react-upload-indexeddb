import { useCallback, useEffect, useState } from "react";

import { StorageUsage } from "../types/download";
import { useDownloadStore } from "../store/download";

/**
 * 存储报告钩子
 *
 * 用于报告和管理存储使用情况
 */
const useStorageReporter = () => {
  const { getStorageUsage, cleanupStorage, config } = useDownloadStore();
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * 加载存储使用情况
   */
  const loadStorageUsage = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const usage = await getStorageUsage();
      setStorageUsage(usage);
      return usage;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [getStorageUsage]);

  /**
   * 清理存储
   */
  const cleanup = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await cleanupStorage();
      await loadStorageUsage();
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [cleanupStorage, loadStorageUsage]);

  /**
   * 格式化文件大小
   */
  const formatSize = useCallback((bytes: number): string => {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  }, []);

  /**
   * 检查存储是否接近配额
   */
  const isStorageNearQuota = useCallback((): boolean => {
    if (!storageUsage) return false;

    // 如果使用率超过90%，认为接近配额
    return storageUsage.usagePercentage > 90;
  }, [storageUsage]);

  /**
   * 初始加载
   */
  useEffect(() => {
    loadStorageUsage();

    // 每10分钟刷新一次存储使用情况
    const intervalId = setInterval(() => {
      loadStorageUsage();
    }, 10 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [loadStorageUsage]);

  return {
    storageUsage,
    isLoading,
    error,
    loadStorageUsage,
    cleanup,
    formatSize,
    isStorageNearQuota,
    storageQuota: config.storageQuota,
  };
};

export default useStorageReporter;
