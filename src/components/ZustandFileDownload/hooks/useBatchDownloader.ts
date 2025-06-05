import { BatchInfo, DownloadStatus } from "../types/download";
import { useCallback, useEffect, useRef } from "react";

import { useDownloadStore } from "../store/download";

// 添加NodeJS类型声明
declare global {
  interface Window {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
  }
}

/**
 * 批量下载钩子
 *
 * 用于管理批量下载任务，处理批次信息，支持批量操作和清理
 */
export const useBatchDownloader = () => {
  const {
    downloadTasks,
    batchInfo,
    updateBatchInfo,
    startDownload,
    getDownloadTask,
    updateDownloadTask,
    config,
    isNetworkOffline,
    getMessageApi,
    activeDownloads,
    isDownloading,
    setIsDownloading,
  } = useDownloadStore();

  // 用于存储清理倒计时的定时器
  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 用于存储已完成的文件ID
  const completedFilesRef = useRef<Set<string>>(new Set());
  // 当前批次信息
  const batchInfoRef = useRef<BatchInfo | null>(batchInfo);

  // 更新批次信息引用
  useEffect(() => {
    batchInfoRef.current = batchInfo;
  }, [batchInfo]);

  /**
   * 下载所有队列中的文件
   */
  const downloadAll = useCallback(async () => {
    // 如果网络离线，无法开始下载
    if (isNetworkOffline) {
      getMessageApi().error("网络已断开，无法开始下载");
      return false;
    }

    // 如果已经有下载任务在进行，不重复启动
    if (isDownloading) {
      return false;
    }

    // 获取所有待下载的文件
    const queuedTasks = downloadTasks.filter(
      (task) => task.status === DownloadStatus.QUEUED
    );

    if (queuedTasks.length === 0) {
      getMessageApi().info("没有待下载的文件");
      return false;
    }

    // 初始化批次信息
    const newBatchInfo: BatchInfo = {
      current: 0,
      total: queuedTasks.length,
      queued: queuedTasks.length,
      active: 0,
      completed: 0,
      failed: 0,
      retried: 0,
    };

    // 更新批次信息
    updateBatchInfo(newBatchInfo);
    completedFilesRef.current.clear();
    setIsDownloading(true);

    // 开始下载
    processNextDownloads();
    return true;
  }, [
    downloadTasks,
    isNetworkOffline,
    isDownloading,
    getMessageApi,
    updateBatchInfo,
    setIsDownloading,
  ]);

  /**
   * 处理下一批下载任务
   */
  const processNextDownloads = useCallback(() => {
    // 如果网络离线，暂停处理
    if (isNetworkOffline) {
      return;
    }

    // 获取当前可以下载的文件数
    const maxConcurrent = config.maxConcurrentDownloads;
    const canStartCount = Math.max(0, maxConcurrent - activeDownloads);

    if (canStartCount <= 0) {
      return;
    }

    // 获取所有待下载的文件
    const queuedTasks = downloadTasks.filter(
      (task) => task.status === DownloadStatus.QUEUED
    );

    // 按优先级排序
    queuedTasks.sort((a, b) => a.priority - b.priority);

    // 开始下载
    const tasksToStart = queuedTasks.slice(0, canStartCount);
    tasksToStart.forEach((task) => {
      startDownload(task.id);
    });
  }, [
    downloadTasks,
    activeDownloads,
    config.maxConcurrentDownloads,
    isNetworkOffline,
    startDownload,
  ]);

  /**
   * 监听下载任务状态变化，更新批次信息
   */
  useEffect(() => {
    if (!batchInfoRef.current) {
      return;
    }

    const newBatchInfo = { ...batchInfoRef.current };
    let completedCount = 0;
    let failedCount = 0;
    let queuedCount = 0;
    let activeCount = 0;
    let totalCount = 0;

    // 统计各种状态的任务数量
    downloadTasks.forEach((task) => {
      // 只统计当前批次中的任务
      if (task.status === DownloadStatus.QUEUED) {
        queuedCount++;
        totalCount++;
      } else if (
        task.status === DownloadStatus.DOWNLOADING ||
        task.status === DownloadStatus.PREPARING ||
        task.status === DownloadStatus.MERGING
      ) {
        activeCount++;
        totalCount++;
      } else if (task.status === DownloadStatus.COMPLETED) {
        // 检查是否是新完成的文件
        if (!completedFilesRef.current.has(task.id)) {
          completedFilesRef.current.add(task.id);
          newBatchInfo.current++;
        }
        completedCount++;
        totalCount++;
      } else if (
        task.status === DownloadStatus.FAILED ||
        task.status === DownloadStatus.MERGE_ERROR
      ) {
        failedCount++;
        totalCount++;
      }
    });

    // 确保current不超过total
    newBatchInfo.current = Math.min(newBatchInfo.current, totalCount);

    // 更新批次信息
    newBatchInfo.queued = queuedCount;
    newBatchInfo.active = activeCount;
    newBatchInfo.completed = completedCount;
    newBatchInfo.failed = failedCount;
    newBatchInfo.total = totalCount;

    // 检查是否所有文件都已处理完成
    const allCompleted =
      completedCount + failedCount === totalCount && totalCount > 0;

    // 如果所有文件都已处理完成，开始清理倒计时
    if (allCompleted && config.autoCleanup && !newBatchInfo.countdown) {
      const countdownSeconds = Math.ceil(config.cleanupDelay / 1000);
      newBatchInfo.countdown = countdownSeconds;

      // 启动倒计时
      if (cleanupTimerRef.current) {
        clearInterval(cleanupTimerRef.current);
      }

      cleanupTimerRef.current = setInterval(() => {
        if (batchInfoRef.current && batchInfoRef.current.countdown) {
          const newCount = batchInfoRef.current.countdown - 1;

          if (newCount <= 0) {
            // 倒计时结束，执行清理
            clearInterval(cleanupTimerRef.current!);
            cleanupTimerRef.current = null;
            executeCleanup();
          } else {
            // 更新倒计时
            updateBatchInfo({
              ...batchInfoRef.current,
              countdown: newCount,
            });
          }
        }
      }, 1000);
    }

    // 更新批次信息
    updateBatchInfo(newBatchInfo);

    // 如果有空闲槽位，处理下一批下载
    if (activeCount < config.maxConcurrentDownloads && queuedCount > 0) {
      processNextDownloads();
    }
  }, [
    downloadTasks,
    config.maxConcurrentDownloads,
    config.autoCleanup,
    config.cleanupDelay,
    updateBatchInfo,
    processNextDownloads,
  ]);

  /**
   * 执行清理操作
   */
  const executeCleanup = useCallback(() => {
    // 清理已完成的文件
    downloadTasks.forEach((task) => {
      if (task.status === DownloadStatus.COMPLETED) {
        // 从UI中移除，但保留在IndexedDB中
        updateDownloadTask(task.id, {
          status: DownloadStatus.COMPLETED,
          completedAt: Date.now(),
        });
      }
    });

    // 清除批次信息
    updateBatchInfo(null);
    completedFilesRef.current.clear();
    setIsDownloading(false);
  }, [downloadTasks, updateDownloadTask, updateBatchInfo, setIsDownloading]);

  /**
   * 取消下载
   */
  const cancelDownload = useCallback(
    (taskId: string) => {
      const task = getDownloadTask(taskId);
      if (!task) return false;

      // 更新任务状态
      updateDownloadTask(taskId, {
        status: DownloadStatus.CANCELED,
      });

      return true;
    },
    [getDownloadTask, updateDownloadTask]
  );

  /**
   * 重试下载
   */
  const retryDownload = useCallback(
    (taskId: string) => {
      const task = getDownloadTask(taskId);
      if (
        !task ||
        (task.status !== DownloadStatus.FAILED &&
          task.status !== DownloadStatus.MERGE_ERROR)
      ) {
        return false;
      }

      // 更新任务状态
      updateDownloadTask(taskId, {
        status: DownloadStatus.QUEUED,
        progress: 0,
        error: undefined,
        retryCount: task.retryCount + 1,
      });

      // 如果当前有活跃的下载，直接开始下载
      if (isDownloading) {
        processNextDownloads();
      }

      return true;
    },
    [getDownloadTask, updateDownloadTask, isDownloading, processNextDownloads]
  );

  /**
   * 重试所有失败的下载
   */
  const retryAllFailedDownloads = useCallback(() => {
    const failedTasks = downloadTasks.filter(
      (task) =>
        task.status === DownloadStatus.FAILED ||
        task.status === DownloadStatus.MERGE_ERROR
    );

    if (failedTasks.length === 0) {
      getMessageApi().info("没有失败的下载任务");
      return false;
    }

    // 重试所有失败的任务
    failedTasks.forEach((task) => {
      retryDownload(task.id);
    });

    // 如果当前没有活跃的下载，开始下载
    if (!isDownloading) {
      downloadAll();
    }

    return true;
  }, [downloadTasks, retryDownload, isDownloading, downloadAll, getMessageApi]);

  /**
   * 清除批次信息
   */
  const clearBatchInfo = useCallback(() => {
    if (cleanupTimerRef.current) {
      clearInterval(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
    updateBatchInfo(null);
    completedFilesRef.current.clear();
    setIsDownloading(false);
  }, [updateBatchInfo, setIsDownloading]);

  /**
   * 强制清理
   */
  const forceCleanup = useCallback(() => {
    if (cleanupTimerRef.current) {
      clearInterval(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
    executeCleanup();
  }, [executeCleanup]);

  /**
   * 暂停所有下载
   */
  const pauseAllDownloads = useCallback(() => {
    const activeTasks = downloadTasks.filter(
      (task) => task.status === DownloadStatus.DOWNLOADING
    );

    if (activeTasks.length === 0) {
      getMessageApi().info("没有活跃的下载任务");
      return false;
    }

    // 暂停所有活跃的任务
    activeTasks.forEach((task) => {
      updateDownloadTask(task.id, {
        status: DownloadStatus.PAUSED,
      });
    });

    return true;
  }, [downloadTasks, updateDownloadTask, getMessageApi]);

  /**
   * 继续所有暂停的下载
   */
  const resumeAllDownloads = useCallback(() => {
    // 如果网络离线，无法继续下载
    if (isNetworkOffline) {
      getMessageApi().error("网络已断开，无法继续下载");
      return false;
    }

    const pausedTasks = downloadTasks.filter(
      (task) => task.status === DownloadStatus.PAUSED
    );

    if (pausedTasks.length === 0) {
      getMessageApi().info("没有暂停的下载任务");
      return false;
    }

    // 继续所有暂停的任务
    pausedTasks.forEach((task) => {
      updateDownloadTask(task.id, {
        status: DownloadStatus.QUEUED,
      });
    });

    // 如果当前没有活跃的下载，开始下载
    if (!isDownloading) {
      setIsDownloading(true);
      processNextDownloads();
    }

    return true;
  }, [
    downloadTasks,
    updateDownloadTask,
    isNetworkOffline,
    isDownloading,
    getMessageApi,
    setIsDownloading,
    processNextDownloads,
  ]);

  /**
   * 取消所有下载
   */
  const cancelAllDownloads = useCallback(() => {
    const activeTasks = downloadTasks.filter(
      (task) =>
        task.status === DownloadStatus.DOWNLOADING ||
        task.status === DownloadStatus.QUEUED ||
        task.status === DownloadStatus.PAUSED
    );

    if (activeTasks.length === 0) {
      getMessageApi().info("没有活跃或等待的下载任务");
      return false;
    }

    // 取消所有活跃和等待的任务
    activeTasks.forEach((task) => {
      updateDownloadTask(task.id, {
        status: DownloadStatus.CANCELED,
      });
    });

    // 清除批次信息
    clearBatchInfo();

    return true;
  }, [downloadTasks, updateDownloadTask, getMessageApi, clearBatchInfo]);

  /**
   * 组件卸载时清理定时器
   */
  useEffect(() => {
    return () => {
      if (cleanupTimerRef.current) {
        clearInterval(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
    };
  }, []);

  return {
    downloadAll,
    pauseAllDownloads,
    resumeAllDownloads,
    cancelAllDownloads,
    cancelDownload,
    retryDownload,
    retryAllFailedDownloads,
    clearBatchInfo,
    forceCleanup,
  };
};

export default useBatchDownloader;
