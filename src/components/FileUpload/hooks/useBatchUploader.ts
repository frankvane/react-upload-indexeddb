import { UploadFile, UploadStatus } from "../types/upload";
import { useCallback, useEffect, useRef, useState } from "react";

import PQueue from "p-queue";
import localforage from "localforage";

const workerUrl = new URL("../worker/uploadWorker.ts", import.meta.url).href;

interface UseBatchUploaderOptions {
  setProgressMap?: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  refreshFiles?: () => void;
  fileConcurrency?: number; // 并发上传文件数
}

export function useBatchUploader(options?: UseBatchUploaderOptions) {
  const [batchInfo, setBatchInfo] = useState<{
    current: number;
    total: number;
    queued: number;
    active: number;
    completed: number;
    failed: number;
  } | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const queueRef = useRef<PQueue | null>(null);
  const cancelTokenRef = useRef<AbortController | null>(null);

  // 初始化队列或当并发数变更时更新队列配置
  useEffect(() => {
    if (!queueRef.current) {
      queueRef.current = new PQueue({
        concurrency: options?.fileConcurrency || 2,
        autoStart: true,
      });
    } else if (options?.fileConcurrency) {
      queueRef.current.concurrency = options.fileConcurrency;
    }

    return () => {
      if (queueRef.current) {
        queueRef.current.clear();
      }
    };
  }, [options?.fileConcurrency]);

  // 取消所有上传任务
  const cancelUpload = useCallback(() => {
    if (queueRef.current) {
      queueRef.current.clear();
      queueRef.current.pause();
    }

    if (cancelTokenRef.current) {
      cancelTokenRef.current.abort();
    }

    setIsUploading(false);
    setBatchInfo(null);
  }, []);

  // 上传单个文件的任务
  const uploadFile = useCallback(
    async (file: UploadFile) => {
      if (!file || !file.buffer) return false;

      try {
        if (options?.setProgressMap) {
          options.setProgressMap((prev) => ({ ...prev, [file.id]: 0 }));
        }

        // 上传前，状态设为 UPLOADING
        await localforage.setItem(file.id, {
          ...file,
          status: UploadStatus.UPLOADING,
        });

        if (options?.refreshFiles) {
          options.refreshFiles();
        }

        return await new Promise<boolean>((resolve, reject) => {
          const worker = new Worker(workerUrl);
          worker.postMessage({ fileInfo: file, fileBuffer: file.buffer });

          worker.onmessage = async (e) => {
            if (e.data.type === "progress") {
              if (options?.setProgressMap) {
                options.setProgressMap((prev) => ({
                  ...prev,
                  [file.id]: e.data.progress,
                }));
              }
            } else if (e.data.type === "done") {
              if (options?.setProgressMap) {
                options.setProgressMap((prev) => ({ ...prev, [file.id]: 100 }));
              }

              // 上传完成或秒传，状态设为 DONE 或 INSTANT
              const newStatus = e.data.skipped
                ? UploadStatus.INSTANT
                : UploadStatus.DONE;

              await localforage.setItem(file.id, {
                ...file,
                status: newStatus,
              });

              if (options?.refreshFiles) {
                options.refreshFiles();
              }

              worker.terminate();
              resolve(true);
            }
          };

          worker.onerror = (error) => {
            console.error("Worker error:", error);
            reject(error);
          };
        });
      } catch (error) {
        console.error(`上传文件失败: ${file.fileName}`, error);

        // 更新文件状态为错误
        await localforage.setItem(file.id, {
          ...file,
          status: UploadStatus.ERROR,
          errorMessage: error instanceof Error ? error.message : String(error),
        });

        if (options?.refreshFiles) {
          options.refreshFiles();
        }

        return false;
      }
    },
    [options]
  );

  // 批量上传所有文件
  const uploadAll = useCallback(async () => {
    if (isUploading) return;
    setIsUploading(true);

    try {
      // 创建新的中止控制器
      cancelTokenRef.current = new AbortController();

      // 确保队列已清空并重新启动
      if (queueRef.current) {
        queueRef.current.clear();
        queueRef.current.start();
      }

      const keys = await localforage.keys();
      const uploadableFiles: UploadFile[] = [];

      // 获取所有可上传的文件
      for (const key of keys) {
        const file = await localforage.getItem<UploadFile>(key);
        if (
          file &&
          file.buffer &&
          file.status !== UploadStatus.DONE &&
          file.status !== UploadStatus.INSTANT
        ) {
          uploadableFiles.push(file);
        }
      }

      if (uploadableFiles.length === 0) {
        setIsUploading(false);
        return;
      }

      // 初始化批处理信息
      setBatchInfo({
        current: 0,
        total: uploadableFiles.length,
        queued: uploadableFiles.length,
        active: 0,
        completed: 0,
        failed: 0,
      });

      // 监听队列事件以更新状态
      queueRef.current?.on("active", () => {
        setBatchInfo((prev) =>
          prev
            ? {
                ...prev,
                active: queueRef.current?.pending || 0,
                queued: queueRef.current?.size || 0,
              }
            : null
        );
      });

      queueRef.current?.on("completed", () => {
        setBatchInfo((prev) =>
          prev
            ? {
                ...prev,
                completed: prev.completed + 1,
                current: prev.current + 1,
              }
            : null
        );
      });

      queueRef.current?.on("error", () => {
        setBatchInfo((prev) =>
          prev
            ? {
                ...prev,
                failed: prev.failed + 1,
                current: prev.current + 1,
              }
            : null
        );
      });

      // 将所有上传任务添加到队列
      const uploadPromises = uploadableFiles.map((file) => {
        return queueRef.current?.add(() => uploadFile(file));
      });

      // 等待所有任务完成
      await Promise.all(uploadPromises);

      // 清理并重置状态
      if (options?.refreshFiles) {
        options.refreshFiles();
      }
    } catch (error) {
      console.error("批量上传文件失败:", error);
    } finally {
      setIsUploading(false);
      setBatchInfo(null);
      cancelTokenRef.current = null;
    }
  }, [isUploading, uploadFile, options?.refreshFiles]);

  return {
    uploadAll,
    batchInfo,
    isUploading,
    cancelUpload,
  };
}
