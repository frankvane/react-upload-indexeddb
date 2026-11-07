/**
 * 下载生命周期（编排基础设施）：download / merge worker 的创建、消息路由与销毁。
 *
 * 本 hook 只负责 worker 的副作用生命周期——创建两个 Web Worker、绑定 onmessage
 * 把事件分派给编排层注入的处理器、卸载时 terminate。它不含任何业务逻辑
 * （业务在 useFileDownloaderController.ts 与 services/ 中）。
 *
 * 分片落盘串行化（P1-1）：worker 逐条 postMessage(CHUNK_DOWNLOADED)，浏览器不会等待
 * 上一个 async handler 的 Promise，COMPLETE 可能先于落盘完成到达。这里按 fileId
 * 维护落盘 Promise 链，COMPLETE 前先 await 该文件全部落盘任务，避免把「尚在写入」
 * 的分片误判为缺失。
 */

import { useEffect, useRef } from "react";

import { createDownloadWorker, createMergeWorker } from "../worker";

export interface DownloadLifecycleHandlers {
  onProgress: (payload: {
    fileId: string;
    progress: number;
    downloadedChunks: number;
  }) => void;
  onChunkDownloaded: (payload: {
    fileId: string;
    chunkIndex: number;
    blob: Blob;
    size: number;
  }) => Promise<void>;
  onComplete: (payload: { fileId: string }) => Promise<void>;
  onError: (payload: { fileId: string; error: string }) => void;
  onPaused: (payload: { fileId: string }) => Promise<void>;
  onMergeComplete: (payload: { fileId: string; blob: Blob }) => Promise<void>;
  onMergeError: (payload: { fileId: string; error: string }) => void;
}

export interface DownloaderLifecycle {
  downloadWorkerRef: React.MutableRefObject<Worker | null>;
  mergeWorkerRef: React.MutableRefObject<Worker | null>;
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export function useDownloaderLifecycle(
  handlers: DownloadLifecycleHandlers
): DownloaderLifecycle {
  const {
    onProgress,
    onChunkDownloaded,
    onComplete,
    onError,
    onPaused,
    onMergeComplete,
    onMergeError,
  } = handlers;

  const downloadWorkerRef = useRef<Worker | null>(null);
  const mergeWorkerRef = useRef<Worker | null>(null);

  // 跨 effect 重跑保留：落盘队列与失败原因都按 fileId 维度记录。
  const pendingWritesRef = useRef(new Map<string, Promise<void>>());
  const writeErrorsRef = useRef(new Map<string, string>());

  useEffect(() => {
    const downloadWorker = createDownloadWorker();
    const mergeWorker = createMergeWorker();

    downloadWorkerRef.current = downloadWorker;
    mergeWorkerRef.current = mergeWorker;

    downloadWorker.onmessage = (event) => {
      const { type, payload } = event.data;

      if (type === "PROGRESS") {
        onProgress(payload);
      } else if (type === "CHUNK_DOWNLOADED") {
        const fileId: string = payload.fileId;
        const previous = pendingWritesRef.current.get(fileId) ?? Promise.resolve();
        const task = previous
          .catch(() => undefined)
          .then(() => onChunkDownloaded(payload))
          .catch((err: unknown) => {
            // 落盘失败不再静默（P2-5）：记录原因，COMPLETE 时按失败上报。
            writeErrorsRef.current.set(fileId, errorMessage(err));
          });

        pendingWritesRef.current.set(fileId, task);
        void task.finally(() => {
          if (pendingWritesRef.current.get(fileId) === task) {
            pendingWritesRef.current.delete(fileId);
          }
        });
      } else if (type === "COMPLETE") {
        const fileId: string = payload.fileId;
        void (async () => {
          const pending = pendingWritesRef.current.get(fileId);
          if (pending) {
            await pending.catch(() => undefined);
          }

          const writeError = writeErrorsRef.current.get(fileId);
          if (writeError) {
            writeErrorsRef.current.delete(fileId);
            onError({ fileId, error: `分片落盘失败: ${writeError}` });
            return;
          }

          await onComplete(payload);
        })();
      } else if (type === "ERROR") {
        writeErrorsRef.current.delete(payload.fileId);
        onError(payload);
      } else if (type === "PAUSED") {
        void onPaused(payload);
      }
    };

    mergeWorker.onmessage = async (event) => {
      const { type, payload } = event.data;
      if (type === "MERGE_COMPLETE") {
        await onMergeComplete(payload);
      } else if (type === "ERROR") {
        onMergeError(payload);
      }
    };

    return () => {
      downloadWorker.terminate();
      mergeWorker.terminate();
    };
  }, [
    onProgress,
    onChunkDownloaded,
    onComplete,
    onError,
    onPaused,
    onMergeComplete,
    onMergeError,
  ]);

  return { downloadWorkerRef, mergeWorkerRef };
}
