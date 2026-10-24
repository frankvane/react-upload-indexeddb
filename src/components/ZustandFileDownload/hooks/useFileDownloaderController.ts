import { DownloadFile, DownloadStatus } from "../types";
import { completeFileStore, exportFileToLocal, fileStore } from "../utils";
import { useCallback, useMemo, useRef, useState } from "react";
import { resolveAuthHeaders } from "../../../shared/authHeaders";

import { ChunkPersistenceService } from "../services/chunkPersistenceService";
import { createDownloadEventHandlers } from "../services/downloadEventHandlers";
import { MergeService } from "../services/mergeService";
import {
  addProcessingFile,
  removeProcessingFile,
  shouldEmitProgressUpdate,
} from "../services/downloadOrchestrator";
import { message } from "../../../ui";
import { useDownloadStore } from "../store";
import { useDownloadContext } from "../context/useDownloadContext";
import { useStorageManager } from "./useStorageManager";
import { useShallow } from "zustand/react/shallow";
import {
  buildStartDownloadMessage,
  buildUpdateConcurrencyMessage,
  normalizeDownloadFile,
} from "./downloadPolicy";
import { useDownloaderLifecycle } from "./useDownloaderLifecycle";

export const useFileDownloader = () => {
  const {
    updateFile,
    addAbortController,
    removeAbortController,
    abortControllers,
  } = useDownloadStore(
    useShallow((state) => ({
      updateFile: state.updateFile,
      addAbortController: state.addAbortController,
      removeAbortController: state.removeAbortController,
      abortControllers: state.abortControllers,
    }))
  );

  // 鉴权配置来自 DownloadProvider props（与上传侧同一套语义）。
  // 逐项解构而非整个 context 对象，避免 useCallback 依赖随 context value 抖动。
  const {
    authToken,
    getAuthToken,
    getAuthHeaders,
    authScheme,
    withCredentials,
  } = useDownloadContext();

  const { getStorageUsage } = useStorageManager();

  const lastProgressUpdate = useRef<
    Record<string, { time: number; progress: number }>
  >({});

  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());

  const chunkService = useMemo(() => new ChunkPersistenceService(), []);

  const mergeService = useMemo(
    () =>
      new MergeService({
        updateFile,
        onStorageUpdated: () => {
          void getStorageUsage(true);
        },
      }),
    [getStorageUsage, updateFile]
  );

  const addProcessing = useCallback((fileId: string) => {
    setProcessingFiles((prev) => addProcessingFile(prev, fileId));
  }, []);

  const removeProcessing = useCallback((fileId: string) => {
    setProcessingFiles((prev) => removeProcessingFile(prev, fileId));
  }, []);

  const handleDownloadProgress = useCallback(
    (payload: { fileId: string; progress: number; downloadedChunks: number }) => {
      if (!shouldEmitProgressUpdate(lastProgressUpdate.current, payload)) {
        return;
      }

      updateFile(payload.fileId, {
        progress: payload.progress,
        downloadedChunks: payload.downloadedChunks,
        status: DownloadStatus.DOWNLOADING,
      });
    },
    [updateFile]
  );

  const handleChunkDownloaded = useCallback(
    async (payload: { fileId: string; chunkIndex: number; blob: Blob; size: number }) => {
      await chunkService.saveChunkWithRetry(
        payload.fileId,
        payload.chunkIndex,
        payload.blob,
        payload.size
      );
    },
    [chunkService]
  );

  const downloadEventHandlers = useMemo(
    () =>
      createDownloadEventHandlers({
        chunkService,
        mergeService,
        removeProcessing,
        updateFile,
      }),
    [chunkService, mergeService, removeProcessing, updateFile]
  );

  // 生命周期：download / merge worker 的创建、消息路由与卸载销毁。
  const { downloadWorkerRef, mergeWorkerRef } = useDownloaderLifecycle({
    onProgress: handleDownloadProgress,
    onChunkDownloaded: handleChunkDownloaded,
    onComplete: downloadEventHandlers.handleDownloadComplete,
    onError: downloadEventHandlers.handleDownloadError,
    onPaused: downloadEventHandlers.handleDownloadPaused,
    onMergeComplete: downloadEventHandlers.handleMergeComplete,
    onMergeError: downloadEventHandlers.handleMergeError,
  });

  const mergeFile = useCallback(
    async (file: DownloadFile) => {
      if (processingFiles.has(file.id)) {
        return;
      }

      try {
        addProcessing(file.id);
        updateFile(file.id, { status: DownloadStatus.PREPARING, error: undefined });

        if (await mergeService.hasMergedFile(file.id)) {
          await mergeService.markCompleted(file);
          removeProcessing(file.id);
          return;
        }

        const { chunks, missingChunks } = await chunkService.collectChunks(
          file.id,
          file.totalChunks
        );

        if (missingChunks.length > 0) {
          await mergeService.markPausedForMissingChunks(
            file,
            missingChunks,
            "分片缺失，请点击继续按钮重新下载"
          );
          removeProcessing(file.id);
          message.warning(`文件 ${file.fileName} 有部分分片缺失，请点击继续下载`);
          return;
        }

        if (mergeWorkerRef.current) {
          mergeWorkerRef.current.postMessage({
            type: "MERGE_FILE",
            payload: {
              fileId: file.id,
              totalChunks: file.totalChunks,
              mimeType: file.mimeType,
              chunks,
              expectedMd5: file.md5,
            },
          });
          return;
        }

        await mergeService.mergeInMainThread(file);
        // 合并后异步清理分片，避免双份占用（P1-12）
        void chunkService
          .removeAllChunks(file.id, file.totalChunks)
          .catch(() => undefined);
        removeProcessing(file.id);
      } catch (err) {
        updateFile(file.id, {
          status: DownloadStatus.ERROR,
          error: `合并文件失败: ${err instanceof Error ? err.message : "未知错误"}`,
        });
        removeProcessing(file.id);
        message.error(`合并文件失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    },
    [addProcessing, chunkService, mergeService, processingFiles, removeProcessing, updateFile, mergeWorkerRef]
  );

  const startDownload = useCallback(
    async (file: DownloadFile) => {
      try {
        const {
          chunkSize: storeChunkSize,
          fileConcurrency,
          chunkConcurrency,
        } = useDownloadStore.getState();

        addProcessing(file.id);
        updateFile(file.id, { status: DownloadStatus.PREPARING, error: undefined });

        await Promise.all([fileStore.ready(), chunkService.ensureReady()]);

        const { normalizedFile, finalChunkSize } = normalizeDownloadFile(
          file,
          storeChunkSize
        );

        const filePatch: Partial<DownloadFile> = {};
        if (normalizedFile.chunkSize !== file.chunkSize) {
          filePatch.chunkSize = normalizedFile.chunkSize;
        }
        if (normalizedFile.totalChunks !== file.totalChunks) {
          filePatch.totalChunks = normalizedFile.totalChunks;
        }

        if (Object.keys(filePatch).length > 0) {
          updateFile(file.id, filePatch);
          await fileStore.setItem(file.id, normalizedFile);
        }

        const pendingChunks = await chunkService.getPendingChunks(
          file.id,
          normalizedFile.totalChunks
        );

        if (pendingChunks.length === 0) {
          await mergeFile(normalizedFile);
          return;
        }

        const controller = new AbortController();
        addAbortController(file.id, controller);

        const downloadedChunks = normalizedFile.totalChunks - pendingChunks.length;
        const progress = Math.round((downloadedChunks / normalizedFile.totalChunks) * 100);

        updateFile(file.id, {
          status: DownloadStatus.DOWNLOADING,
          downloadedChunks,
          progress,
          chunkSize: finalChunkSize,
          error: undefined,
        });

        await fileStore.setItem(file.id, {
          ...normalizedFile,
          status: DownloadStatus.DOWNLOADING,
          downloadedChunks,
          progress,
          chunkSize: finalChunkSize,
          error: undefined,
        });

        if (!downloadWorkerRef.current) {
          throw new Error("下载 Worker 未初始化");
        }

        // 每次开始下载前解析最新鉴权头（支持 token 刷新），随消息下发 Worker
        const authHeaders = await resolveAuthHeaders({
          authToken,
          getAuthToken,
          getAuthHeaders,
          authScheme,
        });

        downloadWorkerRef.current.postMessage(
          buildStartDownloadMessage({
            fileId: file.id,
            fileSize: file.fileSize,
            finalChunkSize,
            totalChunks: normalizedFile.totalChunks,
            pendingChunks,
            fileConcurrency,
            chunkConcurrency,
            authHeaders,
            withCredentials,
          })
        );

        downloadWorkerRef.current.postMessage(
          buildUpdateConcurrencyMessage(fileConcurrency, chunkConcurrency)
        );
      } catch (err) {
        updateFile(file.id, {
          status: DownloadStatus.ERROR,
          error: err instanceof Error ? err.message : "未知错误",
        });
        removeProcessing(file.id);
        message.error(`开始下载失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    },
    [addAbortController, addProcessing, authScheme, authToken, chunkService, getAuthHeaders, getAuthToken, mergeFile, removeProcessing, updateFile, withCredentials, downloadWorkerRef]
  );

  const pauseDownload = useCallback(
    async (fileId: string) => {
      const file = await fileStore.getItem<DownloadFile>(fileId);
      if (!file) {
        return;
      }

      downloadWorkerRef.current?.postMessage({
        type: "PAUSE_DOWNLOAD",
        payload: { fileId },
      });

      const controller = abortControllers[fileId];
      if (controller) {
        controller.abort();
        removeAbortController(fileId);
      }

      updateFile(fileId, { status: DownloadStatus.PAUSED, error: undefined });
      message.info(`正在暂停下载 ${file.fileName}...`);
    },
    [abortControllers, removeAbortController, updateFile, downloadWorkerRef]
  );

  const resumeDownload = useCallback(
    async (fileId: string) => {
      try {
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) {
          return;
        }

        if (processingFiles.has(fileId)) {
          removeProcessing(fileId);
        }

        updateFile(fileId, { status: DownloadStatus.PREPARING, error: undefined });
        message.info(`继续下载 ${file.fileName}`);
        await startDownload(file);
      } catch {
        removeProcessing(fileId);
        message.error("继续下载失败");
      }
    },
    [processingFiles, removeProcessing, startDownload, updateFile]
  );

  const cancelDownload = useCallback(
    async (fileId: string, updateStorage = true) => {
      const file = await fileStore.getItem<DownloadFile>(fileId);
      if (!file) {
        return;
      }

      updateFile(fileId, {
        status: DownloadStatus.IDLE,
        progress: 0,
        downloadedChunks: 0,
        error: undefined,
      });

      const controller = abortControllers[fileId];
      if (controller) {
        controller.abort();
        removeAbortController(fileId);
      }

      downloadWorkerRef.current?.postMessage({ type: "CANCEL", payload: { fileId } });

      await chunkService.removeAllChunks(fileId, file.totalChunks);
      await completeFileStore.removeItem(fileId);

      await fileStore.setItem(fileId, {
        ...file,
        status: DownloadStatus.IDLE,
        progress: 0,
        downloadedChunks: 0,
        error: undefined,
      });

      removeProcessing(fileId);

      if (updateStorage) {
        void getStorageUsage(true);
      }
    },
    [abortControllers, chunkService, getStorageUsage, removeAbortController, removeProcessing, updateFile, downloadWorkerRef]
  );

  const deleteFile = useCallback(
    async (fileId: string) => {
      await cancelDownload(fileId, false);
      await fileStore.removeItem(fileId);
      void getStorageUsage(true);
    },
    [cancelDownload, getStorageUsage]
  );

  const exportFile = useCallback(async (file: DownloadFile) => {
    const success = await exportFileToLocal(file);
    if (success) {
      message.success(`文件 ${file.fileName} 导出成功`);
    } else {
      message.error(`文件 ${file.fileName} 导出失败`);
    }
    return success;
  }, []);

  const resetProcessingState = useCallback(
    (fileId: string) => {
      if (!processingFiles.has(fileId)) {
        return false;
      }

      removeProcessing(fileId);
      return true;
    },
    [processingFiles, removeProcessing]
  );

  return {
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteFile,
    exportFile,
    mergeFile,
    resetProcessingState,
    processingFiles: Array.from(processingFiles),
  };
};
