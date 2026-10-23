import { UploadFile, UploadStatus } from "../types/upload";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { UploadCleanupPolicy } from "../services/cleanupPolicy";
import { loadAllUploadFiles, runConcurrentQueue } from "../services/uploadOrchestrator";
import { useUploadStore } from "../store/upload";
import { useUploadEngine, type UploadEngine } from "../context/UploadEngineContext";
import { useEffectiveUploadConfig } from "./useEffectiveConfig";
import { useShallow } from "zustand/react/shallow";
import { isUploadableStatus } from "../services/uploadStorage";
import { resolveAuthHeaders } from "../utils/auth";

const createCleanupPolicy = (engine: UploadEngine) =>
  new UploadCleanupPolicy({
    getFiles: () => engine.store.getState().files,
    setFiles: (files) => engine.store.getState().setFiles(files),
    refreshFiles: () => engine.store.getState().refreshFiles(),
    setBatchInfo: (updater) => engine.store.getState().setBatchInfo(updater),
    clearBatchInfo: () => engine.store.getState().setBatchInfo(null),
    getCleanupDelay: () => engine.store.getState().cleanupDelay,
    storage: engine.storage,
    fileRegistry: engine.fileRegistry,
  });

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
  const engine = useUploadEngine();

  const cleanupPolicy = useMemo(() => createCleanupPolicy(engine), [engine]);
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

    // T3.1：文件字节不再驻留 IndexedDB，改由主线程 fileRegistry 持有运行时引用。
    // 页面刷新后注册表清空 → 需用户重新选择同一文件方可续传（服务端分片检查决定跳过范围）。
    const fileRef = engine.fileRegistry.getFileRef(file.id);
    if (!fileRef) {
      file.status = UploadStatus.ERROR;
      file.progress = 0;
      file.errorMessage = "文件引用已失效，请重新选择该文件以继续上传";
      file.awaitingReselect = true;
      await engine.storage.setItem(file.id, file);
      scheduleRefresh();
      return false;
    }

    file.status = UploadStatus.UPLOADING;
    await engine.storage.setItem(file.id, file);
    scheduleRefresh();

    const result = await engine.workerPool.runUploadTask({
      file,
      fileRef,
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
        mergeApi: uploadConfig.mergeApi,
        authHeaders: await resolveAuthHeaders(uploadConfig),
        withCredentials: uploadConfig.withCredentials,
        debug: uploadConfig.debug,
        hashMode: uploadConfig.hashMode,
      },
      onProgress: (progress) => {
        setProgressMap((prev) => ({
          ...prev,
          [file.id]: progress,
        }));

        uploadConfig.onUploadProgress?.(file, progress);
      },
    });

    const latest = (await engine.storage.getItem<UploadFile>(file.id)) ?? file;

    if (result.cancelled || signal?.aborted) {
      // 取消语义：状态回 QUEUED 可重新入队（保留 fileRef 以便后续重传/续传）
      latest.status = UploadStatus.QUEUED;
      latest.errorMessage = undefined;
      latest.awaitingReselect = false;
      await engine.storage.setItem(file.id, latest);
      scheduleRefresh();
      return false;
    }

    if (result.success) {
      latest.status = result.skipped ? UploadStatus.INSTANT : UploadStatus.DONE;
      latest.progress = 100;
      latest.errorMessage = undefined;
      // 上传完成：释放文件引用，避免 File 句柄长期驻留
      engine.fileRegistry.releaseFileRef(file.id);

      await engine.storage.setItem(file.id, latest);
      scheduleRefresh();

      uploadConfig.onUploadComplete?.(latest, true);
      await cleanupPolicy.addCompletedFile(file.id);
      return true;
    }

    latest.status = UploadStatus.ERROR;
    latest.errorMessage = result.errorMessage ?? "上传失败";
    await engine.storage.setItem(file.id, latest);
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

    const allFiles = await loadAllUploadFiles(engine.storage);
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
          await engine.storage.setItem(file.id, file);
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

    // P1-8：abort 只会让主线程 Promise 落败，Worker 内在途 fetch 需显式
    // CANCEL 才会中断（bridge 收到 signal 后会 terminate 兜底）
    const uploadingFiles = engine.store
      .getState()
      .files.filter((file) => file.status === UploadStatus.UPLOADING);
    for (const file of uploadingFiles) {
      engine.workerPool.cancelUploadTask(file.id);
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
    await engine.storage.setItem(file.id, file);

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

    const allFiles = await loadAllUploadFiles(engine.storage);
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
          await engine.storage.setItem(file.id, file);

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

