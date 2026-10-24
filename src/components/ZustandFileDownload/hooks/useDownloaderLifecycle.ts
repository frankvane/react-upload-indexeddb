/**
 * 下载生命周期（编排基础设施）：download / merge worker 的创建、消息路由与销毁。
 *
 * 本 hook 只负责 worker 的副作用生命周期——创建两个 Web Worker、绑定 onmessage
 * 把事件分派给编排层注入的处理器、卸载时 terminate。它不含任何业务逻辑
 * （业务在 useFileDownloaderController.ts 与 services/ 中）。
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

  useEffect(() => {
    const downloadWorker = createDownloadWorker();
    const mergeWorker = createMergeWorker();

    downloadWorkerRef.current = downloadWorker;
    mergeWorkerRef.current = mergeWorker;

    downloadWorker.onmessage = async (event) => {
      const { type, payload } = event.data;

      if (type === "PROGRESS") {
        onProgress(payload);
      } else if (type === "CHUNK_DOWNLOADED") {
        await onChunkDownloaded(payload);
      } else if (type === "COMPLETE") {
        await onComplete(payload);
      } else if (type === "ERROR") {
        onError(payload);
      } else if (type === "PAUSED") {
        await onPaused(payload);
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
