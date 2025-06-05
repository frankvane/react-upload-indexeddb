import { UploadFile, UploadStatus } from "../types/upload";
import { useEffect, useRef } from "react";

import localforage from "localforage";
import { useUploadStore } from "../store/upload";

// 导入Worker
const UploadWorker = new Worker(
  new URL("../worker/uploadWorker.ts", import.meta.url),
  { type: "module" }
);

export function useBatchUploader() {
  const {
    isNetworkOffline,
    networkType,
    fileConcurrency,
    chunkConcurrency,
    chunkSize,
    refreshFiles,
    setProgressMap,
    setBatchInfo,
    setIsUploading,
    getMessageApi,
    autoCleanup = true, // 默认开启自动清理
    files,
    setFiles,
  } = useUploadStore();

  const messageApi = getMessageApi();

  // 使用ref来存储已完成上传但尚未从UI中删除的文件ID
  const completedFilesRef = useRef<string[]>([]);
  // 使用ref存储清理定时器
  const cleanupTimerRef = useRef<number | null>(null);

  // 组件初始化时检查并清理已上传的文件
  useEffect(() => {
    if (autoCleanup) {
      // 延迟执行，避免影响应用启动性能
      const timer = setTimeout(() => {
        cleanupUploadedFiles();
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [autoCleanup]);

  // 组件卸载时清除定时器
  useEffect(() => {
    return () => {
      if (cleanupTimerRef.current !== null) {
        clearTimeout(cleanupTimerRef.current);
      }
    };
  }, []);

  // 清理已上传文件的函数
  const cleanupUploadedFiles = async () => {
    try {
      console.log("开始检查并清理已上传的文件...");
      const keys = await localforage.keys();
      let cleanedCount = 0;

      for (const key of keys) {
        const file = await localforage.getItem<UploadFile>(key);
        if (file) {
          // 删除已完成上传的文件记录
          if (
            file.status === UploadStatus.DONE ||
            file.status === UploadStatus.INSTANT
          ) {
            await localforage.removeItem(key);
            cleanedCount++;
            console.log(`已从IndexedDB删除已上传文件: ${file.fileName}`);
          }
        }
      }

      if (cleanedCount > 0) {
        console.log(
          `自动清理完成，已从IndexedDB删除 ${cleanedCount} 个已上传的文件记录`
        );
      } else {
        console.log("没有需要从IndexedDB清理的文件");
      }
    } catch (error) {
      console.error("自动清理文件时出错:", error);
    }
  };

  // 从UI中清理已完成的文件
  const cleanupCompletedFilesFromUI = () => {
    if (completedFilesRef.current.length === 0) return;

    console.log(
      `开始从UI中清理 ${completedFilesRef.current.length} 个已完成的文件...`
    );

    // 过滤掉已完成的文件
    const newFiles = files.filter(
      (file) => !completedFilesRef.current.includes(file.id)
    );
    setFiles(newFiles);

    // 清空已完成文件列表
    completedFilesRef.current = [];
    console.log("UI中的已完成文件已清理完毕");

    // 清空定时器引用
    cleanupTimerRef.current = null;
  };

  // 添加文件到已完成列表，并在合适的时候触发UI清理
  const addCompletedFile = (fileId: string) => {
    // 添加到已完成文件列表
    if (!completedFilesRef.current.includes(fileId)) {
      completedFilesRef.current.push(fileId);
      console.log(
        `文件 ${fileId} 已添加到待清理列表，当前列表长度: ${completedFilesRef.current.length}`
      );
    }

    // 如果已经有定时器在运行，不需要再设置新的定时器
    if (cleanupTimerRef.current !== null) {
      return;
    }

    // 设置5秒后清理UI的定时器
    cleanupTimerRef.current = window.setTimeout(() => {
      cleanupCompletedFilesFromUI();
    }, 5000);

    console.log("已设置5秒后清理UI的定时器");
  };

  // 上传所有文件
  const uploadAll = async (): Promise<boolean> => {
    // 如果网络离线，不允许上传
    if (isNetworkOffline) {
      messageApi.error("网络已断开，无法上传文件");
      return false;
    }

    setIsUploading(true);

    // 从IndexedDB获取所有文件
    const keys = await localforage.keys();
    const allFiles: UploadFile[] = [];

    for (const key of keys) {
      const file = await localforage.getItem<UploadFile>(key);
      if (file) {
        allFiles.push(file);
      }
    }

    // 按创建时间排序
    allFiles.sort((a, b) => a.createdAt - b.createdAt);

    // 筛选出可上传的文件（状态为queued或error）
    const uploadableFiles = allFiles.filter(
      (file) =>
        file.status === UploadStatus.QUEUED ||
        file.status === UploadStatus.ERROR
    );

    if (uploadableFiles.length === 0) {
      messageApi.info("没有需要上传的文件");
      setIsUploading(false);
      return false;
    }

    // 初始化批次信息
    const batchInfo = {
      current: 0,
      total: uploadableFiles.length,
      queued: uploadableFiles.length,
      active: 0,
      completed: 0,
      failed: 0,
      retried: 0,
    };
    setBatchInfo(batchInfo);

    // 并发上传控制
    const concurrency = Math.min(fileConcurrency, uploadableFiles.length);
    let activeUploads = 0;
    let currentIndex = 0;

    // 创建一个Promise，在所有上传完成后解析
    return new Promise((resolve) => {
      // 启动上传函数
      const startNextUpload = async () => {
        // 如果所有文件都已经处理完毕，结束上传
        if (currentIndex >= uploadableFiles.length && activeUploads === 0) {
          setIsUploading(false);
          await refreshFiles();
          resolve(true);
          return;
        }

        // 当有空闲并且还有文件要上传时，启动新的上传
        while (
          activeUploads < concurrency &&
          currentIndex < uploadableFiles.length
        ) {
          const file = uploadableFiles[currentIndex];
          currentIndex++;
          activeUploads++;

          // 更新批次信息
          setBatchInfo((prev) => ({
            ...prev!,
            queued: prev!.queued - 1,
            active: prev!.active + 1,
          }));

          // 更新文件状态为准备上传
          file.status = UploadStatus.PREPARING_UPLOAD;
          await localforage.setItem(file.id, file);

          // 启动上传Worker
          processFileUpload(file)
            .then((success) => {
              // 更新批次信息
              setBatchInfo((prev) => ({
                ...prev!,
                current: prev!.current + 1,
                active: prev!.active - 1,
                completed: success ? prev!.completed + 1 : prev!.completed,
                failed: !success ? prev!.failed + 1 : prev!.failed,
              }));

              activeUploads--;
              startNextUpload(); // 启动下一个上传
            })
            .catch(() => {
              // 更新批次信息
              setBatchInfo((prev) => ({
                ...prev!,
                current: prev!.current + 1,
                active: prev!.active - 1,
                failed: prev!.failed + 1,
              }));

              activeUploads--;
              startNextUpload(); // 启动下一个上传
            });
        }
      };

      // 开始上传
      startNextUpload();
    });
  };

  // 处理单个文件上传
  const processFileUpload = async (file: UploadFile): Promise<boolean> => {
    return new Promise((resolve) => {
      // 获取文件buffer
      localforage.getItem<UploadFile>(file.id).then((fileWithBuffer) => {
        if (!fileWithBuffer || !fileWithBuffer.buffer) {
          // 如果找不到文件或buffer，标记为失败
          file.status = UploadStatus.ERROR;
          file.errorMessage = "文件数据丢失";
          localforage.setItem(file.id, file);
          resolve(false);
          return;
        }

        // 更新文件状态为上传中
        file.status = UploadStatus.UPLOADING;
        localforage.setItem(file.id, file);
        console.log("启动Worker处理上传", file);
        // 启动Worker处理上传
        UploadWorker.postMessage({
          type: "upload",
          fileInfo: file,
          fileBuffer: fileWithBuffer.buffer,
          networkParams: {
            networkType,
            fileConcurrency,
            chunkConcurrency,
            chunkSize,
          },
        });

        // 监听Worker消息
        const handleWorkerMessage = async (event: MessageEvent) => {
          const { type, progress, skipped, message, data } = event.data;

          // 处理 Worker 调试消息
          if (type === "debug") {
            console.log(`[Worker Debug][${file.fileName}] ${message}`, data);
            return;
          }

          if (type === "progress") {
            // 更新上传进度
            setProgressMap((prev) => ({
              ...prev,
              [file.id]: progress,
            }));
          } else if (type === "done") {
            // 上传完成
            const updatedFile = await localforage.getItem<UploadFile>(file.id);
            if (updatedFile) {
              // 文件上传完成，从IndexedDB中完全删除该文件记录
              await localforage.removeItem(file.id);
              console.log(
                `文件 ${file.fileName} 上传完成，已从IndexedDB中删除`
              );

              // 更新文件状态（仅在内存中，不再存储到IndexedDB）
              updatedFile.status = skipped
                ? UploadStatus.INSTANT
                : UploadStatus.DONE;
              updatedFile.progress = 100;

              // 将文件添加到已完成列表，稍后统一从UI中清理
              addCompletedFile(file.id);
            }

            // 移除事件监听器
            UploadWorker.removeEventListener("message", handleWorkerMessage);
            resolve(true);
          } else if (type === "error") {
            // 上传失败
            const updatedFile = await localforage.getItem<UploadFile>(file.id);
            if (updatedFile) {
              updatedFile.status = UploadStatus.ERROR;
              updatedFile.errorMessage = message || "上传失败";
              await localforage.setItem(file.id, updatedFile);
            }

            // 移除事件监听器
            UploadWorker.removeEventListener("message", handleWorkerMessage);
            resolve(false);
          } else if (type === "retry") {
            // 重试上传
            console.log(`[Worker Retry][${file.fileName}] ${message}`);
          }
        };

        UploadWorker.addEventListener("message", handleWorkerMessage);
      });
    });
  };

  // 取消上传
  const cancelUpload = () => {
    setIsUploading(false);
    // 这里可以添加更多取消逻辑，如中断Worker等
  };

  // 清除批次信息
  const clearBatchInfo = () => {
    setBatchInfo(null);
  };

  // 重试单个文件上传
  const retryUploadFile = async (
    file: UploadFile
  ): Promise<{ success: boolean; message: string }> => {
    if (isNetworkOffline) {
      return {
        success: false,
        message: "网络已断开，无法重试上传",
      };
    }

    // 更新文件状态为准备上传
    file.status = UploadStatus.PREPARING_UPLOAD;
    file.progress = 0;
    await localforage.setItem(file.id, file);

    try {
      const success = await processFileUpload(file);
      await refreshFiles();
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

  // 重试所有失败的文件
  const retryAllFailedFiles = async (): Promise<{
    success: boolean;
    message: string;
    retriedCount: number;
  }> => {
    if (isNetworkOffline) {
      return {
        success: false,
        message: "网络已断开，无法重试上传",
        retriedCount: 0,
      };
    }

    // 从IndexedDB获取所有文件
    const keys = await localforage.keys();
    const failedFiles: UploadFile[] = [];

    for (const key of keys) {
      const file = await localforage.getItem<UploadFile>(key);
      if (file && file.status === UploadStatus.ERROR) {
        failedFiles.push(file);
      }
    }

    if (failedFiles.length === 0) {
      return {
        success: false,
        message: "没有需要重试的文件",
        retriedCount: 0,
      };
    }

    // 初始化批次信息
    const batchInfo = {
      current: 0,
      total: failedFiles.length,
      queued: failedFiles.length,
      active: 0,
      completed: 0,
      failed: 0,
      retried: failedFiles.length,
    };
    setBatchInfo(batchInfo);
    setIsUploading(true);

    // 并发上传控制
    const concurrency = Math.min(fileConcurrency, failedFiles.length);
    let activeUploads = 0;
    let currentIndex = 0;
    let successCount = 0;
    let failedCount = 0;

    // 创建一个Promise，在所有重试完成后解析
    return new Promise((resolve) => {
      // 启动重试函数
      const startNextRetry = async () => {
        // 如果所有文件都已经处理完毕，结束重试
        if (currentIndex >= failedFiles.length && activeUploads === 0) {
          setIsUploading(false);
          await refreshFiles();
          resolve({
            success: failedCount === 0,
            message: `重试完成: ${successCount}个成功, ${failedCount}个失败`,
            retriedCount: failedFiles.length,
          });
          return;
        }

        // 当有空闲并且还有文件要重试时，启动新的重试
        while (
          activeUploads < concurrency &&
          currentIndex < failedFiles.length
        ) {
          const file = failedFiles[currentIndex];
          currentIndex++;
          activeUploads++;

          // 更新批次信息
          setBatchInfo((prev) => ({
            ...prev!,
            queued: prev!.queued - 1,
            active: prev!.active + 1,
          }));

          // 重试上传
          retryUploadFile(file)
            .then(({ success }) => {
              // 更新计数
              if (success) {
                successCount++;
              } else {
                failedCount++;
              }

              // 更新批次信息
              setBatchInfo((prev) => ({
                ...prev!,
                current: prev!.current + 1,
                active: prev!.active - 1,
                completed: success ? prev!.completed + 1 : prev!.completed,
                failed: !success ? prev!.failed + 1 : prev!.failed,
              }));

              activeUploads--;
              startNextRetry(); // 启动下一个重试
            })
            .catch(() => {
              failedCount++;

              // 更新批次信息
              setBatchInfo((prev) => ({
                ...prev!,
                current: prev!.current + 1,
                active: prev!.active - 1,
                failed: prev!.failed + 1,
              }));

              activeUploads--;
              startNextRetry(); // 启动下一个重试
            });
        }
      };

      // 开始重试
      startNextRetry();
    });
  };

  // 添加删除文件函数
  async function deleteUploadedFile(fileId: string): Promise<boolean> {
    try {
      // 检查文件是否存在
      const file = await localforage.getItem<UploadFile>(fileId);
      if (!file) {
        console.log(`文件 ${fileId} 不存在，无需删除`);
        return false;
      }

      // 从IndexedDB中删除文件记录
      await localforage.removeItem(fileId);
      console.log(`文件 ${file.fileName} (${fileId}) 已从IndexedDB中删除`);

      // 将文件添加到已完成列表，稍后统一从UI中清理
      addCompletedFile(fileId);

      return true;
    } catch (error) {
      console.error(`删除文件 ${fileId} 时出错:`, error);
      return false;
    }
  }

  // 批量删除所有已上传的文件
  const deleteAllUploadedFiles = async (): Promise<{
    success: boolean;
    deletedCount: number;
    message: string;
  }> => {
    try {
      // 从IndexedDB获取所有文件
      const keys = await localforage.keys();
      let deletedCount = 0;

      for (const key of keys) {
        const file = await localforage.getItem<UploadFile>(key);
        if (
          file &&
          (file.status === UploadStatus.DONE ||
            file.status === UploadStatus.INSTANT)
        ) {
          // 从IndexedDB中删除
          await localforage.removeItem(key);
          deletedCount++;
          console.log(`已从IndexedDB删除文件: ${file.fileName}`);

          // 将文件ID添加到待清理列表
          addCompletedFile(file.id);
        }
      }

      if (deletedCount > 0) {
        messageApi.success(`已删除 ${deletedCount} 个已上传的文件`);
        return {
          success: true,
          deletedCount,
          message: `已删除 ${deletedCount} 个已上传的文件`,
        };
      } else {
        messageApi.info("没有找到已上传的文件");
        return {
          success: true,
          deletedCount: 0,
          message: "没有找到已上传的文件",
        };
      }
    } catch (error) {
      const errorMsg = `删除文件时出错: ${
        error instanceof Error ? error.message : String(error)
      }`;
      console.error("批量删除文件时出错:", error);
      messageApi.error(errorMsg);
      return {
        success: false,
        deletedCount: 0,
        message: errorMsg,
      };
    }
  };

  // 立即清理UI中的已完成文件（供外部调用）
  const forceCleanupUI = () => {
    // 如果有定时器正在运行，先清除它
    if (cleanupTimerRef.current !== null) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    // 立即执行清理
    cleanupCompletedFilesFromUI();
  };

  return {
    uploadAll,
    cancelUpload,
    clearBatchInfo,
    retryUploadFile,
    retryAllFailedFiles,
    deleteUploadedFile,
    deleteAllUploadedFiles,
    cleanupUploadedFiles,
    forceCleanupUI,
    pendingCleanupCount: () => completedFilesRef.current.length, // 返回待清理文件数量
  };
}
