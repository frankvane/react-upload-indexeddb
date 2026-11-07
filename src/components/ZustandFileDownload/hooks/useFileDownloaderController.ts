import { DownloadFile, DownloadStatus } from "../types";
import { completeFileStore, exportFileToLocal, fileStore } from "../utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  // 事件处理器在 merge 实现之前创建，用 ref 桥接避免循环依赖（P0-1）。
  const mergeFileRef = useRef<((file: DownloadFile) => Promise<void>) | null>(null);

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
      const saved = await chunkService.saveChunkWithRetry(
        payload.fileId,
        payload.chunkIndex,
        payload.blob,
        payload.size
      );
      // P2-5：saveChunkWithRetry 失败只返回 false、不抛错；此处必须显式抛出，
      // 否则 useDownloaderLifecycle 的 catch 收不到 → writeErrorsRef 不记录 →
      // COMPLETE 时健康检查把「落盘失败/空间不足」误报成「分片缺失」。
      if (!saved) {
        throw new Error(
          `分片 ${payload.chunkIndex} 落盘失败（可能是存储空间不足）`
        );
      }
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
        mergeFile: async (file) => {
          if (mergeFileRef.current) {
            await mergeFileRef.current(file);
            return;
          }
          // 兜底：ref 尚未挂载时走主线程合并，绝不静默跳过合并（P0-1）。
          await mergeService.mergeInMainThread(file);
          void chunkService
            .removeAllChunks(file.id, file.totalChunks)
            .catch(() => undefined);
        },
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

  // 无重入守卫的合并实现：下载 COMPLETE 时该文件已在 processingFiles 中，
  // 若复用带守卫的 mergeFile 会被直接跳过，导致永不合并（P0-1）。
  const mergeFileInternal = useCallback(
    async (file: DownloadFile) => {
      try {
        addProcessing(file.id);
        updateFile(file.id, { status: DownloadStatus.PREPARING, error: undefined });

        if (await mergeService.hasMergedFile(file.id)) {
          await mergeService.markCompleted(file);
          // 已完成但可能残留分片（上次清理失败）：这里补一次清理，保持单一策略。
          void chunkService
            .removeAllChunks(file.id, file.totalChunks)
            .catch(() => undefined);
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
              // P2-8：采样 md5（>=10MB 且服务端无 DB 元数据）不能用于全量终检，
              // 否则合并必然被判失败；此时跳过比对（merger.worker 已支持缺省）。
              expectedMd5: file.md5Mode === "sample" ? undefined : file.md5,
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
    [addProcessing, chunkService, mergeService, removeProcessing, updateFile, mergeWorkerRef]
  );

  useEffect(() => {
    mergeFileRef.current = mergeFileInternal;
  }, [mergeFileInternal]);

  // 对外（UI / 批量操作）的合并入口：保留幂等守卫，防止重复触发。
  const mergeFile = useCallback(
    async (file: DownloadFile) => {
      if (processingFiles.has(file.id)) {
        return;
      }
      await mergeFileInternal(file);
    },
    [mergeFileInternal, processingFiles]
  );

  const startDownload = useCallback(
    async (file: DownloadFile, options: { force?: boolean } = {}) => {
      // 重入保护（P2-7）：重复点击 / 批量与单文件叠加时不再启动第二条下载循环。
      // resume 场景由调用方显式传 force：此时 removeProcessing 的 state 更新尚未
      // 反映到当前闭包，不能依赖 processingFiles 判断。
      if (!options.force && processingFiles.has(file.id)) {
        return;
      }

      try {
        const {
          chunkSize: storeChunkSize,
          fileConcurrency,
          chunkConcurrency,
        } = useDownloadStore.getState();

        addProcessing(file.id);
        updateFile(file.id, { status: DownloadStatus.PREPARING, error: undefined });

        await Promise.all([fileStore.ready(), chunkService.ensureReady()]);

        // P1-3：分片方案一旦落盘就固化，以 IndexedDB 中的 chunkSize 为准。
        // 分片以「下标」为键，chunkSize 变化会让 totalChunks 跟着变，而
        // getPendingChunks 只判断 0..N-1 是否存在 → 会把残缺分片误判为齐全，
        // 进而合并出损坏文件（md5 缺失时甚至静默产出损坏文件）。
        // 想换分片方案必须先清掉该文件已落盘的分片。
        const persistedFile = await fileStore.getItem<DownloadFile>(file.id);
        const chunkSizeBaseline =
          persistedFile?.chunkSize || file.chunkSize || storeChunkSize;

        const { normalizedFile, finalChunkSize } = normalizeDownloadFile(
          { ...file, chunkSize: chunkSizeBaseline },
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
          await mergeFileInternal(normalizedFile);
          return;
        }

        const controller = new AbortController();
        addAbortController(file.id, controller);

        // P2-5：落盘前预检本地配额。空间明显不足时直接给出明确原因，
        // 避免每个分片都写失败、最后以「文件分片不完整」这种误导性结论收场。
        const neededBytes = pendingChunks.length * finalChunkSize;
        if (!(await chunkService.hasStorageBudget(neededBytes))) {
          const reason = `本地可用存储空间不足，无法缓存 ${file.fileName}（约需 ${Math.ceil(
            neededBytes / 1024 / 1024
          )}MB）`;
          updateFile(file.id, {
            status: DownloadStatus.ERROR,
            error: reason,
          });
          removeProcessing(file.id);
          message.error(reason);
          return;
        }

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
    [addAbortController, addProcessing, authScheme, authToken, chunkService, getAuthHeaders, getAuthToken, mergeFileInternal, processingFiles, removeProcessing, updateFile, withCredentials, downloadWorkerRef]
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
        await startDownload(file, { force: true });
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
