import { UploadFile, UploadStatus } from "../types/upload";
import { useCallback, useEffect, useRef, useState } from "react";

import PQueue from "p-queue";
import localforage from "localforage";

const workerUrl = new URL("../worker/uploadWorker.ts", import.meta.url).href;

interface UseBatchUploaderOptions {
  setProgressMap?: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  refreshFiles?: () => void;
  fileConcurrency?: number; // 并发上传文件数
  chunkConcurrency?: number; // 并发上传分片数
  maxRetries?: number; // 最大重试次数
  timeout?: number; // 请求超时时间（毫秒）
  retryInterval?: number; // 重试间隔时间（毫秒）
}

interface BatchInfo {
  current: number;
  total: number;
  queued: number;
  active: number;
  completed: number;
  failed: number;
  retried: number; // 重试次数统计
}

export function useBatchUploader(options?: UseBatchUploaderOptions) {
  const [batchInfo, setBatchInfo] = useState<BatchInfo | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const queueRef = useRef<PQueue | null>(null);
  const cancelTokenRef = useRef<AbortController | null>(null);
  const retriedCountRef = useRef<number>(0); // 记录重试次数

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

  // 重置所有状态
  const resetState = useCallback(() => {
    setIsUploading(false);
    setBatchInfo(null);
    if (cancelTokenRef.current) {
      cancelTokenRef.current = null;
    }

    // 如果队列存在，清除所有事件监听器
    if (queueRef.current) {
      queueRef.current.removeAllListeners();
    }
  }, []);

  // 取消上传并重置状态
  const cancelUpload = useCallback(() => {
    if (queueRef.current) {
      queueRef.current.clear();
      queueRef.current.pause();
      queueRef.current.removeAllListeners();
    }

    if (cancelTokenRef.current) {
      cancelTokenRef.current.abort();
    }

    resetState();
  }, [resetState]);

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
          worker.postMessage({
            fileInfo: file,
            fileBuffer: file.buffer,
            // 传递网络参数到 worker
            networkParams: {
              chunkConcurrency:
                options?.chunkConcurrency || options?.fileConcurrency || 2,
              maxRetries: options?.maxRetries || 3,
              timeout: options?.timeout || 30000,
              retryInterval: options?.retryInterval || 1000,
            },
          });

          worker.onmessage = async (e) => {
            if (e.data.type === "progress") {
              if (options?.setProgressMap) {
                options.setProgressMap((prev) => ({
                  ...prev,
                  [file.id]: e.data.progress,
                }));
              }
            } else if (e.data.type === "error") {
              // 处理错误情况
              console.error(`文件上传错误: ${file.fileName}`, e.data.message);

              // 更新文件状态为错误
              await localforage.setItem(file.id, {
                ...file,
                status: UploadStatus.ERROR,
                errorMessage: e.data.message,
                failedChunks: e.data.failedChunks || [],
              });

              if (options?.refreshFiles) {
                options.refreshFiles();
              }

              worker.terminate();
              resolve(false); // 上传失败但不中断整体队列
            } else if (e.data.type === "retry") {
              // 更新重试统计
              retriedCountRef.current += 1;
              setBatchInfo((prev) => {
                if (!prev) return null;
                return {
                  ...prev,
                  retried: retriedCountRef.current,
                };
              });
            } else if (e.data.type === "done") {
              if (options?.setProgressMap) {
                options.setProgressMap((prev) => ({ ...prev, [file.id]: 100 }));
              }
              // 明确区分INSTANT和DONE
              const newStatus = e.data.skipped
                ? UploadStatus.INSTANT
                : UploadStatus.DONE;
              await localforage.setItem(file.id, {
                ...file,
                status: newStatus,
                progress: 100,
              });

              if (options?.refreshFiles) {
                options.refreshFiles();
              }
              worker.terminate();
              resolve(true);
            }
          };

          worker.onerror = async (error) => {
            console.error("Worker error:", error);

            // 更新文件状态为错误
            await localforage.setItem(file.id, {
              ...file,
              status: UploadStatus.ERROR,
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });

            if (options?.refreshFiles) {
              options.refreshFiles();
            }

            worker.terminate();
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

  // 单个文件重试上传
  const retryUploadFile = useCallback(
    async (file: UploadFile) => {
      if (isUploading) {
        console.warn("当前有批量上传任务正在进行，请等待完成后再重试");
        return {
          success: false,
          message: "当前有批量上传任务正在进行，请等待完成后再重试",
        };
      }

      // 从IndexedDB中获取最新的文件数据
      try {
        const latestFile = await localforage.getItem<UploadFile>(file.id);
        if (!latestFile || !latestFile.buffer) {
          const errorMessage = "找不到文件或文件数据已丢失";
          console.error(errorMessage, file.fileName);

          // 更新文件状态为错误
          await localforage.setItem(file.id, {
            ...file,
            status: UploadStatus.ERROR,
            errorMessage,
          });

          if (options?.refreshFiles) {
            options.refreshFiles();
          }

          return { success: false, message: errorMessage };
        }

        // 更新状态为上传中
        await localforage.setItem(file.id, {
          ...latestFile,
          status: UploadStatus.UPLOADING,
          errorMessage: undefined, // 清除错误信息
          failedChunks: [], // 清除失败分片记录
          progress: 0, // 重置进度
        });

        if (options?.refreshFiles) {
          options.refreshFiles();
        }

        // 重置进度
        if (options?.setProgressMap) {
          options.setProgressMap((prev) => ({ ...prev, [file.id]: 0 }));
        }

        // 直接调用上传方法
        const uploadResult = await uploadFile(latestFile);

        // 检查最终状态
        const updatedFile = await localforage.getItem<UploadFile>(file.id);

        if (uploadResult && updatedFile?.status === UploadStatus.DONE) {
          return { success: true, message: "文件重试上传成功" };
        } else if (updatedFile?.status === UploadStatus.INSTANT) {
          return { success: true, message: "文件秒传成功" };
        } else {
          const errorMessage =
            updatedFile?.errorMessage || "重试上传失败，原因未知";
          return { success: false, message: errorMessage };
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.error(`重试上传文件失败: ${file.fileName}`, error);

        // 确保文件状态更新为错误
        await localforage.setItem(file.id, {
          ...file,
          status: UploadStatus.ERROR,
          errorMessage,
        });

        if (options?.refreshFiles) {
          options.refreshFiles();
        }

        return { success: false, message: errorMessage };
      }
    },
    [isUploading, options, uploadFile]
  );

  // 检查队列是否完成
  const checkQueueComplete = useCallback(() => {
    if (
      queueRef.current &&
      queueRef.current.size === 0 &&
      queueRef.current.pending === 0
    ) {
      // 如果队列为空且没有待处理任务，则重置状态
      setTimeout(() => {
        // 不再自动重置 batchInfo，让用户可以看到完成状态
        setIsUploading(false);
        cancelTokenRef.current = null;
      }, 1500); // 延迟重置，让用户看到完成状态
      return true;
    }
    return false;
  }, []);

  // 批量上传所有文件
  const uploadAll = useCallback(async () => {
    if (isUploading) return;
    setIsUploading(true);
    retriedCountRef.current = 0; // 重置重试计数

    try {
      // 创建新的中止控制器
      cancelTokenRef.current = new AbortController();

      // 确保队列已清空并重新启动
      if (queueRef.current) {
        queueRef.current.clear();
        // 移除所有之前的事件监听器，防止重复计数
        queueRef.current.removeAllListeners();
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
        resetState();
        return;
      }

      // 初始化批处理信息 - 包含当前批次的信息
      setBatchInfo({
        current: 0,
        total: uploadableFiles.length,
        queued: uploadableFiles.length,
        active: 0,
        completed: 0,
        failed: 0,
        retried: 0,
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
        setBatchInfo((prev) => {
          if (!prev) return null;
          const newInfo = {
            ...prev,
            completed: prev.completed + 1,
            current: prev.current + 1,
          };
          return newInfo;
        });

        // 检查队列是否已完成
        checkQueueComplete();
      });

      queueRef.current?.on("error", () => {
        setBatchInfo((prev) => {
          if (!prev) return null;
          const newInfo = {
            ...prev,
            failed: prev.failed + 1,
            current: prev.current + 1,
          };
          return newInfo;
        });

        // 检查队列是否已完成
        checkQueueComplete();
      });

      // 将所有上传任务添加到队列
      const uploadPromises = uploadableFiles.map((file) => {
        return queueRef.current?.add(() => uploadFile(file));
      });

      // 等待所有任务完成
      await Promise.all(uploadPromises);

      // 检查队列是否已完成（以防万一事件没有触发）
      if (!checkQueueComplete()) {
        // 仅将上传状态设置为完成，保留批次信息以便用户查看
        setIsUploading(false);

        // 清理资源
        if (options?.refreshFiles) {
          options.refreshFiles();
        }
        cancelTokenRef.current = null;
      }
    } catch (error) {
      console.error("批量上传文件失败:", error);
      // 错误情况下仍然保留批次信息，只重置上传状态
      setIsUploading(false);
      cancelTokenRef.current = null;
    }
  }, [
    isUploading,
    uploadFile,
    options?.refreshFiles,
    checkQueueComplete,
    resetState,
  ]);

  // 清除批次信息
  const clearBatchInfo = useCallback(() => {
    setBatchInfo(null);
  }, []);

  // 批量重试所有失败的文件
  const retryAllFailedFiles = useCallback(async () => {
    if (isUploading) {
      console.warn("当前有上传任务正在进行，请等待完成后再重试");
      return {
        success: false,
        message: "当前有上传任务正在进行，请等待完成后再重试",
        retriedCount: 0,
        successCount: 0,
        failedCount: 0,
      };
    }

    try {
      // 获取所有文件
      const keys = await localforage.keys();
      const failedFiles: UploadFile[] = [];

      // 查找所有处于错误状态的文件
      for (const key of keys) {
        const file = await localforage.getItem<UploadFile>(key);
        if (file && file.status === UploadStatus.ERROR) {
          failedFiles.push(file);
        }
      }

      if (failedFiles.length === 0) {
        return {
          success: true,
          message: "没有需要重试的文件",
          retriedCount: 0,
          successCount: 0,
          failedCount: 0,
        };
      }

      // 设置上传状态为进行中
      setIsUploading(true);
      retriedCountRef.current = 0; // 重置重试计数器

      // 初始化批处理信息
      setBatchInfo({
        current: 0,
        total: failedFiles.length,
        queued: failedFiles.length,
        active: 0,
        completed: 0,
        failed: 0,
        retried: 0,
      });

      let successCount = 0;
      let failedCount = 0;

      // 逐个重试文件
      for (let i = 0; i < failedFiles.length; i++) {
        const file = failedFiles[i];

        try {
          // 更新批次信息
          setBatchInfo((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              current: i,
              active: 1,
              queued: failedFiles.length - i - 1,
            };
          });

          // 调用单文件重试上传方法
          const result = await retryUploadFile(file);

          if (result.success) {
            successCount++;
            // 更新批次信息
            setBatchInfo((prev) => {
              if (!prev) return null;
              return {
                ...prev,
                completed: prev.completed + 1,
              };
            });
          } else {
            failedCount++;
            // 更新批次信息
            setBatchInfo((prev) => {
              if (!prev) return null;
              return {
                ...prev,
                failed: prev.failed + 1,
              };
            });
          }
        } catch (error) {
          // 单个文件出错不应该中断整个流程，记录失败并继续
          console.error(`文件 ${file.fileName} 重试出错:`, error);
          failedCount++;

          // 更新批次信息
          setBatchInfo((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              failed: prev.failed + 1,
            };
          });

          // 确保文件状态更新为错误
          await localforage.setItem(file.id, {
            ...file,
            status: UploadStatus.ERROR,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 完成所有重试任务后
      setIsUploading(false);

      // 更新批次信息
      setBatchInfo((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          current: failedFiles.length,
          active: 0,
          queued: 0,
          retried: retriedCountRef.current, // 从计数器获取实际的重试次数
        };
      });

      if (options?.refreshFiles) {
        options.refreshFiles();
      }

      return {
        success: successCount > 0,
        message: `重试完成：${successCount}个成功，${failedCount}个失败`,
        retriedCount: failedFiles.length,
        successCount,
        failedCount,
      };
    } catch (error) {
      console.error("批量重试失败:", error);
      setIsUploading(false);

      // 更新批次信息，显示错误状态
      setBatchInfo((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          active: 0,
          failed: prev?.total || 0,
        };
      });

      if (options?.refreshFiles) {
        options.refreshFiles();
      }

      return {
        success: false,
        message: `批量重试出错: ${
          error instanceof Error ? error.message : String(error)
        }`,
        retriedCount: 0,
        successCount: 0,
        failedCount: 0,
      };
    }
  }, [isUploading, retryUploadFile, options?.refreshFiles]);

  return {
    uploadAll,
    batchInfo,
    isUploading,
    cancelUpload,
    clearBatchInfo,
    retryUploadFile,
    retryAllFailedFiles,
  };
}
