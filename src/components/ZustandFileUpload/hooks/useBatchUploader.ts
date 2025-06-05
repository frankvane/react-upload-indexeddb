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
      let markedCount = 0;

      for (const key of keys) {
        const file = await localforage.getItem<UploadFile>(key);
        if (file) {
          // 清除已完成上传的文件的buffer以节省空间，但不立即删除记录
          if (
            file.status === UploadStatus.DONE ||
            file.status === UploadStatus.INSTANT
          ) {
            if (file.buffer) {
              file.buffer = undefined;
              await localforage.setItem(key, file);
              markedCount++;
              console.log(`已清理文件buffer: ${file.fileName}`);
            }

            // 将文件添加到待清理列表，稍后从UI和IndexedDB中移除
            addCompletedFile(file.id);
          }
        }
      }

      if (markedCount > 0) {
        console.log(
          `自动清理完成，已清理 ${markedCount} 个文件的buffer数据并标记为待清理`
        );

        // 设置10秒后清理的定时器
        if (cleanupTimerRef.current !== null) {
          clearTimeout(cleanupTimerRef.current);
        }

        cleanupTimerRef.current = window.setTimeout(async () => {
          // 先从IndexedDB中删除已完成的文件
          await cleanupCompletedFilesFromIndexedDB();
          // 然后清理UI
          cleanupCompletedFilesFromUI();
        }, 10000);
      } else {
        console.log("没有需要清理的文件");
      }
    } catch (error) {
      console.error("自动清理文件时出错:", error);
    }
  };

  // 从UI中清理已完成的文件（保留需要重试的文件）
  const cleanupCompletedFilesFromUI = () => {
    if (completedFilesRef.current.length === 0) return;

    console.log(
      `开始从UI中清理 ${completedFilesRef.current.length} 个已完成的文件...`
    );

    // 6. 过滤掉已完成的文件，但保留需要重试的文件
    const newFiles = files.filter((file) => {
      // 如果文件在待清理列表中且不是错误状态，则移除
      if (completedFilesRef.current.includes(file.id)) {
        // 检查文件是否为错误状态，只保留错误状态的文件
        const keepFile = file.status === UploadStatus.ERROR;
        if (!keepFile) {
          console.log(`从UI中移除文件: ${file.fileName}, 状态: ${file.status}`);
        } else {
          console.log(`保留错误文件: ${file.fileName}`);
        }
        return keepFile;
      }
      return true; // 保留其他文件
    });

    // 输出清理前后的文件数量，便于调试
    console.log(
      `清理前文件数量: ${files.length}, 清理后文件数量: ${newFiles.length}`
    );

    setFiles(newFiles);

    // 清空已完成文件列表
    completedFilesRef.current = [];
    console.log("UI中的已完成文件已清理完毕，错误文件已保留");

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

    // 注意：不在这里设置定时器，而是在所有上传任务完成后统一设置
    // 这样可以确保只在批量上传全部完成后执行一次延迟清除
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
        // 4. 确认是否所有文件操作完毕
        if (currentIndex >= uploadableFiles.length && activeUploads === 0) {
          setIsUploading(false);

          // 刷新文件列表，确保显示最新状态
          await refreshFiles();

          // 5. 延迟10秒清除所有已上传的状态数据
          console.log(
            "所有文件上传完成，10秒后将清除UI中已上传文件的状态和IndexedDB中的记录"
          );
          if (completedFilesRef.current.length > 0) {
            if (cleanupTimerRef.current !== null) {
              clearTimeout(cleanupTimerRef.current);
            }

            cleanupTimerRef.current = window.setTimeout(async () => {
              // 先从IndexedDB中删除已完成的文件
              await cleanupCompletedFilesFromIndexedDB();
              // 然后清理UI
              cleanupCompletedFilesFromUI();
            }, 10000);
          }

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

          // 立即刷新文件列表，确保UI显示"准备上传"状态
          await refreshFiles();

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

              // 立即刷新文件列表，确保UI显示最新状态
              refreshFiles().then(() => {
                // 启动下一个上传
                startNextUpload();
              });
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

              // 立即刷新文件列表，确保UI显示最新状态
              refreshFiles().then(() => {
                // 启动下一个上传
                startNextUpload();
              });
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
        localforage.setItem(file.id, file).then(() => {
          // 立即刷新文件列表，确保UI显示"上传中"状态
          refreshFiles();
        });

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

            // 如果进度变化较大，刷新文件列表以更新UI
            if (progress % 20 === 0) {
              // 每20%刷新一次
              refreshFiles();
            }
          } else if (type === "done") {
            // 1. 上传完成，修改文件状态
            const updatedFile = await localforage.getItem<UploadFile>(file.id);
            if (updatedFile) {
              // 更新文件状态为已完成
              updatedFile.status = skipped
                ? UploadStatus.INSTANT
                : UploadStatus.DONE;
              updatedFile.progress = 100;

              // 保存更新后的状态到IndexedDB，但清除buffer以节省空间
              updatedFile.buffer = undefined;
              await localforage.setItem(file.id, updatedFile);
              console.log(
                `文件 ${file.fileName} 上传完成，状态已更新为${
                  skipped ? "秒传" : "已完成"
                }`
              );

              // 立即刷新文件列表，确保UI显示最新状态
              await refreshFiles();

              // 将文件添加到已完成列表，稍后统一从UI和IndexedDB中清理
              addCompletedFile(file.id);
            }

            // 移除事件监听器
            UploadWorker.removeEventListener("message", handleWorkerMessage);
            resolve(true);
          } else if (type === "error") {
            // 上传失败，需要保留文件记录以便重试
            const updatedFile = await localforage.getItem<UploadFile>(file.id);
            if (updatedFile) {
              updatedFile.status = UploadStatus.ERROR;
              updatedFile.errorMessage = message || "上传失败";

              // 保留文件记录在IndexedDB中，以便后续重试
              await localforage.setItem(file.id, updatedFile);
              console.log(`文件 ${file.fileName} 上传失败，保留记录以便重试`);

              // 立即刷新文件列表，确保UI显示错误状态
              await refreshFiles();
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

  // 从IndexedDB中删除已完成上传的文件
  const cleanupCompletedFilesFromIndexedDB = async () => {
    try {
      console.log("开始从IndexedDB中删除已完成上传的文件...");

      // 获取所有已完成的文件ID
      const completedFileIds = [...completedFilesRef.current];
      let deletedCount = 0;
      let instantCount = 0;
      let doneCount = 0;

      for (const fileId of completedFileIds) {
        const file = await localforage.getItem<UploadFile>(fileId);
        if (file) {
          if (file.status === UploadStatus.DONE) {
            await localforage.removeItem(fileId);
            deletedCount++;
            doneCount++;
            console.log(`已从IndexedDB删除已上传文件(DONE): ${file.fileName}`);
          } else if (file.status === UploadStatus.INSTANT) {
            await localforage.removeItem(fileId);
            deletedCount++;
            instantCount++;
            console.log(
              `已从IndexedDB删除已上传文件(INSTANT): ${file.fileName}`
            );
          }
        }
      }

      if (deletedCount > 0) {
        console.log(
          `已从IndexedDB中删除 ${deletedCount} 个已上传的文件 (DONE: ${doneCount}, INSTANT: ${instantCount})`
        );
      }
    } catch (error) {
      console.error("从IndexedDB删除已完成文件时出错:", error);
    }
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

      // 如果文件正在上传中，先标记为已取消
      if (
        file.status === UploadStatus.UPLOADING ||
        file.status === UploadStatus.PREPARING_UPLOAD
      ) {
        console.log(`文件 ${file.fileName} 正在上传中，标记为已取消`);
        file.status = UploadStatus.ERROR;
        file.errorMessage = "用户手动取消";
        await localforage.setItem(fileId, file);
      }
      // 如果文件已上传完成，将其添加到待清理列表
      else if (
        file.status === UploadStatus.DONE ||
        file.status === UploadStatus.INSTANT
      ) {
        // 不立即删除，只添加到待清理列表
        console.log(`文件 ${file.fileName} 已标记为待清理`);
      }

      // 将文件添加到待清理列表，稍后从UI中移除
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
      let markedCount = 0;

      for (const key of keys) {
        const file = await localforage.getItem<UploadFile>(key);
        if (
          file &&
          (file.status === UploadStatus.DONE ||
            file.status === UploadStatus.INSTANT)
        ) {
          // 不立即从IndexedDB中删除，只添加到待清理列表
          markedCount++;
          console.log(`文件 ${file.fileName} 已标记为待清理`);

          // 将文件ID添加到待清理列表
          addCompletedFile(file.id);
        }
      }

      if (markedCount > 0) {
        messageApi.success(`已标记 ${markedCount} 个已上传的文件待清理`);

        // 设置10秒后清理的定时器
        if (cleanupTimerRef.current !== null) {
          clearTimeout(cleanupTimerRef.current);
        }

        cleanupTimerRef.current = window.setTimeout(async () => {
          // 先从IndexedDB中删除已完成的文件
          await cleanupCompletedFilesFromIndexedDB();
          // 然后清理UI
          cleanupCompletedFilesFromUI();
        }, 10000);

        return {
          success: true,
          deletedCount: markedCount,
          message: `已标记 ${markedCount} 个已上传的文件待清理`,
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
    cleanupCompletedFilesFromIndexedDB,
    forceCleanupUI,
    pendingCleanupCount: () => completedFilesRef.current.length, // 返回待清理文件数量
  };
}
