import { UploadFile, UploadStatus } from "../types/upload";

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
  } = useUploadStore();

  const messageApi = getMessageApi();

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

        // 启动Worker处理上传
        UploadWorker.postMessage({
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
          const { type, progress, skipped, message } = event.data;

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
              updatedFile.status = skipped
                ? UploadStatus.INSTANT
                : UploadStatus.DONE;
              updatedFile.progress = 100;
              await localforage.setItem(file.id, updatedFile);
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

  return {
    uploadAll,
    cancelUpload,
    clearBatchInfo,
    retryUploadFile,
    retryAllFailedFiles,
  };
}
