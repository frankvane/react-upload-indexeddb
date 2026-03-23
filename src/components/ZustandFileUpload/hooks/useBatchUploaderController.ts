import { UploadFile, UploadStatus } from "../types/upload";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { UploadCleanupPolicy } from "../services/cleanupPolicy";
import localforage from "localforage";
import { loadAllUploadFiles, runConcurrentQueue } from "../services/uploadOrchestrator";
import {
  disposeUploadWorkerPool,
  runUploadTask,
} from "../services/uploadWorkerBridge";
import { useUploadStore } from "../store/upload";
import { useEffectiveUploadConfig } from "./useEffectiveConfig";
import { useShallow } from "zustand/react/shallow";
import { isUploadableStatus } from "../services/uploadStorage";

export interface RetrySummary {
  success: boolean;
  message: string;
  retriedCount: number;
}

export interface BatchUploaderActions {
  uploadAll: () => Promise<boolean>;
  cancelUpload: () => void;
  clearBatchInfo: () => void;
  retryUploadFile: (
    file: UploadFile
  ) => Promise<{ success: boolean; message: string }>;
  retryAllFailedFiles: () => Promise<RetrySummary>;
  forceCleanupUI: () => Promise<void>;
  pendingCleanupCount: () => number;
}

const createCleanupPolicy = () =>
  new UploadCleanupPolicy({
    getFiles: () => useUploadStore.getState().files,
    setFiles: (files) => useUploadStore.getState().setFiles(files),
    refreshFiles: () => useUploadStore.getState().refreshFiles(),
    setBatchInfo: (updater) => useUploadStore.getState().setBatchInfo(updater),
    clearBatchInfo: () => useUploadStore.getState().setBatchInfo(null),
    getCleanupDelay: () => useUploadStore.getState().cleanupDelay,
  });

export function useBatchUploader(): BatchUploaderActions {
  const {
    isNetworkOffline,
    networkType,
    fileConcurrency,
    chunkConcurrency,
    chunkSize,
    maxRetries,
    refreshFiles,
    setProgressMap,
    setBatchInfo,
    setIsUploading,
    getMessageApi,
  } = useUploadStore(
    useShallow((state) => ({
      isNetworkOffline: state.isNetworkOffline,
      networkType: state.networkType,
      fileConcurrency: state.fileConcurrency,
      chunkConcurrency: state.chunkConcurrency,
      chunkSize: state.chunkSize,
      maxRetries: state.maxRetries,
      refreshFiles: state.refreshFiles,
      setProgressMap: state.setProgressMap,
      setBatchInfo: state.setBatchInfo,
      setIsUploading: state.setIsUploading,
      getMessageApi: state.getMessageApi,
    }))
  );

  const uploadConfig = useEffectiveUploadConfig();
  const messageApi = getMessageApi();

  const cleanupPolicy = useMemo(() => createCleanupPolicy(), []);
  const activeUploadAbortRef = useRef<AbortController | null>(null);
  const bootstrapAutoCleanupTimerRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const isRefreshingRef = useRef(false);
  const queuedRefreshRef = useRef(false);

  const flushRefresh = useCallback(async () => {
    if (isRefreshingRef.current) {
      queuedRefreshRef.current = true;
      return;
    }

    isRefreshingRef.current = true;
    try {
      await refreshFiles();
    } finally {
      isRefreshingRef.current = false;
      if (queuedRefreshRef.current) {
        queuedRefreshRef.current = false;
        void flushRefresh().catch(() => undefined);
      }
    }
  }, [refreshFiles]);

  const scheduleRefresh = useCallback(
    (delay = 120) => {
      if (refreshTimerRef.current !== null) {
        return;
      }

      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void flushRefresh().catch(() => undefined);
      }, delay);
    },
    [flushRefresh]
  );

  const beginBatchSession = useCallback(() => {
    const existingController = activeUploadAbortRef.current;
    if (existingController && !existingController.signal.aborted) {
      existingController.abort();
    }

    const controller = new AbortController();
    activeUploadAbortRef.current = controller;
    return controller;
  }, []);

  const endBatchSession = useCallback((controller: AbortController) => {
    if (activeUploadAbortRef.current === controller) {
      activeUploadAbortRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      const activeController = activeUploadAbortRef.current;
      if (activeController && !activeController.signal.aborted) {
        activeController.abort();
      }
      activeUploadAbortRef.current = null;

      if (bootstrapAutoCleanupTimerRef.current !== null) {
        clearTimeout(bootstrapAutoCleanupTimerRef.current);
        bootstrapAutoCleanupTimerRef.current = null;
      }

      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      queuedRefreshRef.current = false;
      cleanupPolicy.dispose();
      disposeUploadWorkerPool();
    };
  }, [cleanupPolicy]);

  useEffect(() => {
    if (!uploadConfig.autoCleanup) {
      if (bootstrapAutoCleanupTimerRef.current !== null) {
        clearTimeout(bootstrapAutoCleanupTimerRef.current);
        bootstrapAutoCleanupTimerRef.current = null;
      }
      cleanupPolicy.dispose();
      setBatchInfo((prev) => {
        if (!prev) {
          return null;
        }
        return {
          ...prev,
          countdown: undefined,
        };
      });
      return;
    }

    if (bootstrapAutoCleanupTimerRef.current !== null) {
      return;
    }

    bootstrapAutoCleanupTimerRef.current = window.setTimeout(() => {
      bootstrapAutoCleanupTimerRef.current = null;
      void cleanupPolicy.cleanupUploadedFiles();
    }, 2000);
  }, [uploadConfig.autoCleanup, cleanupPolicy, setBatchInfo]);

  const processFileUpload = async (
    file: UploadFile,
    signal?: AbortSignal
  ): Promise<boolean> => {
    if (signal?.aborted) {
      return false;
    }

    const fileWithBuffer = await localforage.getItem<UploadFile>(file.id);

    if (!fileWithBuffer?.buffer) {
      file.status = UploadStatus.ERROR;
      file.errorMessage = "文件数据丢失";
      await localforage.setItem(file.id, file);
      scheduleRefresh();
      return false;
    }

    file.status = UploadStatus.UPLOADING;
    await localforage.setItem(file.id, file);
    scheduleRefresh();

    const result = await runUploadTask({
      file,
      fileBuffer: fileWithBuffer.buffer,
      signal,
      networkParams: {
        networkType,
        fileConcurrency,
        chunkConcurrency,
        chunkSize,
        maxRetries,
      },
      uploadConfig: {
        baseURL: uploadConfig.baseURL,
        uploadApi: uploadConfig.uploadApi,
        checkApi: uploadConfig.checkApi,
      },
      onProgress: (progress) => {
        setProgressMap((prev) => ({
          ...prev,
          [file.id]: progress,
        }));

        uploadConfig.onUploadProgress?.(file, progress);
      },
    });

    const latest = (await localforage.getItem<UploadFile>(file.id)) ?? file;

    if (result.cancelled || signal?.aborted) {
      latest.status = UploadStatus.QUEUED;
      latest.errorMessage = undefined;
      await localforage.setItem(file.id, latest);
      scheduleRefresh();
      return false;
    }

    if (result.success) {
      latest.status = result.skipped ? UploadStatus.INSTANT : UploadStatus.DONE;
      latest.progress = 100;
      latest.buffer = undefined;
      latest.errorMessage = undefined;

      await localforage.setItem(file.id, latest);
      scheduleRefresh();

      uploadConfig.onUploadComplete?.(latest, true);
      await cleanupPolicy.addCompletedFile(file.id);
      return true;
    }

    latest.status = UploadStatus.ERROR;
    latest.errorMessage = result.errorMessage ?? "上传失败";
    await localforage.setItem(file.id, latest);
    scheduleRefresh();

    uploadConfig.onUploadError?.(latest, latest.errorMessage);
    return false;
  };

  const finalizeBatch = async (
    summary: { successCount: number; failedCount: number },
    total: number
  ) => {
    setIsUploading(false);
    await flushRefresh();

    const pending = cleanupPolicy.pendingCount();

    setBatchInfo((prev) => {
      if (!prev) {
        return {
          current: total,
          total,
          queued: 0,
          active: 0,
          completed: summary.successCount,
          failed: summary.failedCount,
          retried: 0,
          countdown: uploadConfig.cleanupDelay,
        };
      }

      return {
        ...prev,
        current: total,
        total,
        queued: 0,
        active: 0,
        completed: summary.successCount,
        failed: summary.failedCount,
        countdown: uploadConfig.autoCleanup
          ? uploadConfig.cleanupDelay
          : undefined,
      };
    });

    uploadConfig.onBatchComplete?.({
      success: summary.successCount,
      failed: summary.failedCount,
      total,
    });

    if (uploadConfig.autoCleanup && pending > 0) {
      cleanupPolicy.scheduleCleanup(uploadConfig.cleanupDelay);
    }
  };

  const uploadAll = async (): Promise<boolean> => {
    if (isNetworkOffline) {
      messageApi.error("网络已断开，无法上传文件");
      return false;
    }

    const allFiles = await loadAllUploadFiles();
    const uploadableFiles = allFiles.filter((file) => isUploadableStatus(file.status));

    if (uploadableFiles.length === 0) {
      messageApi.info("没有需要上传的文件");
      setIsUploading(false);
      return false;
    }

    const batchController = beginBatchSession();
    setIsUploading(true);

    uploadConfig.onUploadStart?.(uploadableFiles);

    setBatchInfo({
      current: 0,
      total: uploadableFiles.length,
      queued: uploadableFiles.length,
      active: 0,
      completed: 0,
      failed: 0,
      retried: 0,
    });

    try {
      const summary = await runConcurrentQueue({
        items: uploadableFiles,
        concurrency: Math.min(fileConcurrency, uploadableFiles.length),
        shouldStop: () => batchController.signal.aborted,
        beforeEach: async (file) => {
          if (batchController.signal.aborted) {
            return;
          }

          file.status = UploadStatus.PREPARING_UPLOAD;
          file.progress = 0;
          await localforage.setItem(file.id, file);
          scheduleRefresh();

          setBatchInfo((prev) => {
            if (!prev) {
              return null;
            }

            return {
              ...prev,
              queued: Math.max(0, prev.queued - 1),
              active: prev.active + 1,
            };
          });
        },
        task: (file) => processFileUpload(file, batchController.signal),
        onSettled: async ({ success }) => {
          if (batchController.signal.aborted) {
            return;
          }

          setBatchInfo((prev) => {
            if (!prev) {
              return null;
            }

            return {
              ...prev,
              current: prev.current + 1,
              active: Math.max(0, prev.active - 1),
              completed: success ? prev.completed + 1 : prev.completed,
              failed: success ? prev.failed : prev.failed + 1,
            };
          });

          scheduleRefresh();
        },
      });

      if (batchController.signal.aborted) {
        return false;
      }

      await finalizeBatch(summary, uploadableFiles.length);
      return true;
    } finally {
      endBatchSession(batchController);
    }
  };

  const cancelUpload = () => {
    const activeController = activeUploadAbortRef.current;
    if (activeController && !activeController.signal.aborted) {
      activeController.abort();
      messageApi.info("已取消当前上传任务");
    }

    setIsUploading(false);
    setBatchInfo(null);
  };

  const clearBatchInfo = () => {
    setBatchInfo(null);
  };

  const retryUploadFile = async (
    file: UploadFile
  ): Promise<{ success: boolean; message: string }> => {
    if (isNetworkOffline) {
      return {
        success: false,
        message: "网络已断开，无法重试上传",
      };
    }

    file.status = UploadStatus.PREPARING_UPLOAD;
    file.progress = 0;
    file.errorMessage = undefined;
    await localforage.setItem(file.id, file);

    try {
      const success = await processFileUpload(file);
      await flushRefresh();

      if (success && uploadConfig.autoCleanup && cleanupPolicy.pendingCount() > 0) {
        cleanupPolicy.scheduleCleanup(uploadConfig.cleanupDelay);
      }

      return {
        success,
        message: success ? "重试上传成功" : "重试上传失败",
      };
    } catch {
      return {
        success: false,
        message: "重试上传时发生错误",
      };
    }
  };

  const retryAllFailedFiles = async (): Promise<RetrySummary> => {
    if (isNetworkOffline) {
      return {
        success: false,
        message: "网络已断开，无法重试上传",
        retriedCount: 0,
      };
    }

    const allFiles = await loadAllUploadFiles();
    const failedFiles = allFiles.filter((file) => file.status === UploadStatus.ERROR);

    if (failedFiles.length === 0) {
      return {
        success: false,
        message: "没有需要重试的文件",
        retriedCount: 0,
      };
    }

    const batchController = beginBatchSession();
    setIsUploading(true);
    setBatchInfo({
      current: 0,
      total: failedFiles.length,
      queued: failedFiles.length,
      active: 0,
      completed: 0,
      failed: 0,
      retried: failedFiles.length,
    });

    try {
      const summary = await runConcurrentQueue({
        items: failedFiles,
        concurrency: Math.min(fileConcurrency, failedFiles.length),
        shouldStop: () => batchController.signal.aborted,
        beforeEach: async (file) => {
          if (batchController.signal.aborted) {
            return;
          }

          file.status = UploadStatus.PREPARING_UPLOAD;
          file.progress = 0;
          file.errorMessage = undefined;
          await localforage.setItem(file.id, file);

          setBatchInfo((prev) => {
            if (!prev) {
              return null;
            }

            return {
              ...prev,
              queued: Math.max(0, prev.queued - 1),
              active: prev.active + 1,
            };
          });
        },
        task: (file) => processFileUpload(file, batchController.signal),
        onSettled: ({ success }) => {
          if (batchController.signal.aborted) {
            return;
          }

          setBatchInfo((prev) => {
            if (!prev) {
              return null;
            }

            return {
              ...prev,
              current: prev.current + 1,
              active: Math.max(0, prev.active - 1),
              completed: success ? prev.completed + 1 : prev.completed,
              failed: success ? prev.failed : prev.failed + 1,
            };
          });
        },
      });

      if (batchController.signal.aborted) {
        return {
          success: false,
          message: "批量重试已取消",
          retriedCount: 0,
        };
      }

      await finalizeBatch(summary, failedFiles.length);

      return {
        success: summary.failedCount === 0,
        message: `重试完成: ${summary.successCount}个成功, ${summary.failedCount}个失败`,
        retriedCount: failedFiles.length,
      };
    } finally {
      endBatchSession(batchController);
    }
  };

  const forceCleanupUI = async () => {
    await cleanupPolicy.forceCleanupUI();
  };

  return {
    uploadAll,
    cancelUpload,
    clearBatchInfo,
    retryUploadFile,
    retryAllFailedFiles,
    forceCleanupUI,
    pendingCleanupCount: () => cleanupPolicy.pendingCount(),
  };
}

