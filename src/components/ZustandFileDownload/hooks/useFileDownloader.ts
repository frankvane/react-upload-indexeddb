import * as apiClient from "../api.client.js";

import { DownloadFile, DownloadStatus } from "../types";
import {
  chunkStore,
  completeFileStore,
  exportFileToLocal,
  fileStore,
  mergeFileChunks,
} from "../utils";
import { createDownloadWorker, createMergeWorker } from "../worker";
import { useCallback, useEffect, useRef, useState } from "react";

import { message } from "antd";
import { useDownloadStore } from "../store";
import { useStorageManager } from "./useStorageManager";

/**
 * 文件下载管理Hook
 */
export const useFileDownloader = () => {
  const {
    updateFile,
    addAbortController,
    removeAbortController,
    abortControllers,
  } = useDownloadStore();

  // 使用存储管理Hook
  const { updateLocalSize, getStorageUsage, calculateFileSize } =
    useStorageManager();

  // 下载Worker引用
  const downloadWorkerRef = useRef<Worker | null>(null);
  const mergeWorkerRef = useRef<Worker | null>(null);

  // 正在处理的文件
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(
    new Set()
  );

  // 初始化Worker
  useEffect(() => {
    // 创建Worker
    const downloadWorker = createDownloadWorker();
    const mergeWorker = createMergeWorker();

    // 设置Worker引用
    downloadWorkerRef.current = downloadWorker;
    mergeWorkerRef.current = mergeWorker;

    // 设置下载Worker消息处理
    downloadWorker.onmessage = async (event) => {
      const { type, payload } = event.data;

      console.log(`接收到Worker消息: ${type}`, payload);

      switch (type) {
        case "PROGRESS":
          handleDownloadProgress(payload);
          break;
        case "CHUNK_DOWNLOADED":
          await handleChunkDownloaded(payload);
          break;
        case "COMPLETE":
          await handleDownloadComplete(payload);
          break;
        case "ERROR":
          handleDownloadError(payload);
          break;
        case "PAUSED":
          if (typeof handleDownloadPaused === "function") {
            handleDownloadPaused(payload);
          } else {
            console.log(`确认下载已暂停: ${payload.fileId}`);
            if (typeof updateFile === "function") {
              updateFile(payload.fileId, { status: DownloadStatus.PAUSED });
            } else {
              console.error("updateFile不可用");
            }

            setProcessingFiles((prev) => {
              const newSet = new Set(prev);
              newSet.delete(payload.fileId);
              return newSet;
            });
          }
          break;
        case "RESUMED":
          console.log(`下载已恢复: ${payload.fileId}`);
          break;
        case "CANCELLED":
          console.log(`下载已取消: ${payload.fileId}`);
          break;
        default:
          console.log(`未处理的消息类型: ${type}`);
      }
    };

    // 设置合并Worker消息处理
    mergeWorker.onmessage = async (event) => {
      const { type, payload } = event.data;

      console.log(`接收到合并Worker消息: ${type}`);

      switch (type) {
        case "MERGE_COMPLETE":
          await handleMergeComplete(payload);
          break;
        case "ERROR":
          handleMergeError(payload);
          break;
        default:
          console.log(`未处理的合并消息类型: ${type}`);
      }
    };

    // 清理函数
    return () => {
      downloadWorker.terminate();
      mergeWorker.terminate();
      console.log("Worker已终止");
    };
  }, []);

  // 处理下载进度
  const handleDownloadProgress = useCallback(
    (payload: {
      fileId: string;
      progress: number;
      downloadedChunks: number;
    }) => {
      const { fileId, progress, downloadedChunks } = payload;

      updateFile(fileId, {
        progress,
        downloadedChunks,
        status: DownloadStatus.DOWNLOADING,
      });
    },
    [updateFile]
  );

  // 处理分片下载完成
  const handleChunkDownloaded = useCallback(
    async (payload: {
      fileId: string;
      chunkIndex: number;
      blob: Blob;
      size: number;
    }) => {
      const { fileId, chunkIndex, blob, size } = payload;
      const maxRetries = 3;
      let retryCount = 0;
      let success = false;

      while (!success && retryCount < maxRetries) {
        try {
          // 确保存储已初始化
          await chunkStore.ready();

          // 验证Blob是否有效
          if (!blob || blob.size === 0) {
            throw new Error(
              `分片 ${chunkIndex} 数据无效，大小为 ${blob ? blob.size : 0}`
            );
          }

          // 存储分片到IndexedDB
          const chunkId = `${fileId}_chunk_${chunkIndex}`;
          await chunkStore.setItem(chunkId, blob);

          // 验证分片是否成功保存
          const savedChunk = await chunkStore.getItem<Blob>(chunkId);
          if (!savedChunk || savedChunk.size !== size) {
            throw new Error(
              `分片 ${chunkIndex} 保存后验证失败，预期大小 ${size}，实际大小 ${
                savedChunk ? savedChunk.size : 0
              }`
            );
          }

          console.log(
            `分片 ${chunkIndex} 已成功保存到IndexedDB，大小: ${size} 字节`
          );
          success = true;
        } catch (error) {
          retryCount++;
          console.error(
            `存储分片 ${chunkIndex} 失败 (尝试 ${retryCount}/${maxRetries}):`,
            error
          );

          if (retryCount >= maxRetries) {
            console.error(`分片 ${chunkIndex} 存储失败，已达到最大重试次数`);
            // 可以在这里添加额外的错误处理，如通知主线程
          } else {
            // 短暂延迟后重试
            await new Promise((resolve) => setTimeout(resolve, 500));
            console.log(`尝试重新保存分片 ${chunkIndex}...`);
          }
        }
      }

      return success;
    },
    []
  );

  // 处理下载完成
  const handleDownloadComplete = useCallback(
    async (payload: { fileId: string; downloadedChunks: number }) => {
      const { fileId } = payload;

      try {
        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) return;

        console.log(
          `处理文件 ${file.fileName} 下载完成，开始验证分片完整性...`
        );

        // 在更新状态前进行分片完整性检查
        await chunkStore.ready();
        let allChunksExist = true;
        const missingChunks: number[] = [];
        const corruptChunks: number[] = [];

        // 首先检查所有分片是否存在
        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${fileId}_chunk_${i}`;
          const chunk = await chunkStore.getItem<Blob>(chunkId);
          if (!chunk) {
            allChunksExist = false;
            missingChunks.push(i);
          } else if (chunk.size === 0) {
            // 检查分片是否有效（大小为0的分片视为损坏）
            allChunksExist = false;
            corruptChunks.push(i);
          }
        }

        // 如果有缺失或损坏的分片
        if (!allChunksExist) {
          const problemChunks = [...missingChunks, ...corruptChunks];
          console.warn(
            `下载完成但检测到文件 ${file.fileName} 有分片问题：缺失 ${missingChunks.length} 个，损坏 ${corruptChunks.length} 个`
          );

          // 删除损坏的分片，以便重新下载
          for (const chunkIndex of corruptChunks) {
            const chunkId = `${fileId}_chunk_${chunkIndex}`;
            await chunkStore.removeItem(chunkId);
            console.log(`已删除损坏的分片 ${chunkIndex}`);
          }

          // 更新文件状态为需要继续下载
          const totalProblemChunks = problemChunks.length;
          const completedChunks = file.totalChunks - totalProblemChunks;
          const progress = Math.round(
            (completedChunks / file.totalChunks) * 100
          );

          updateFile(fileId, {
            status: DownloadStatus.PAUSED,
            downloadedChunks: completedChunks,
            progress: progress,
            error: `有${totalProblemChunks}个分片问题（缺失: ${missingChunks.length}, 损坏: ${corruptChunks.length}），请点击"继续"按钮重新下载`,
          });

          // 保存到IndexedDB
          await fileStore.setItem(fileId, {
            ...file,
            status: DownloadStatus.PAUSED,
            downloadedChunks: completedChunks,
            progress: progress,
            error: `有${totalProblemChunks}个分片问题（缺失: ${missingChunks.length}, 损坏: ${corruptChunks.length}），请点击"继续"按钮重新下载`,
          });

          // 移除处理中状态
          setProcessingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(fileId);
            return newSet;
          });

          message.warning(
            `文件 ${file.fileName} 下载不完整，请点击"继续"按钮重试`
          );
          return;
        }

        console.log(`文件 ${file.fileName} 所有分片验证完成，开始合并...`);

        // 所有分片都存在且有效，更新文件状态
        updateFile(fileId, {
          status: DownloadStatus.COMPLETED,
          progress: 100,
          completedAt: Date.now(),
        });

        // 保存到IndexedDB以确保刷新后能正确显示完成状态
        await fileStore.setItem(fileId, {
          ...file,
          status: DownloadStatus.COMPLETED,
          progress: 100,
          completedAt: Date.now(),
        });

        // 开始合并文件
        setTimeout(() => {
          // 使用setTimeout来避免直接调用mergeFile，防止循环引用
          if (file) {
            mergeFile(file).catch((error) => {
              console.error("延迟合并文件失败:", error);
            });
          }
        }, 0);

        // 移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });

        // 显示成功消息
        message.success(`文件 ${file.fileName} 下载完成`);

        // 计算已下载的文件大小并更新存储使用情况
        let downloadedSize = 0;
        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${fileId}_chunk_${i}`;
          const chunk = await chunkStore.getItem<Blob>(chunkId);
          if (chunk) {
            downloadedSize += chunk.size;
          }
        }

        console.log(
          `文件 ${file.fileName} 下载完成，大小：${downloadedSize} 字节`
        );

        // 更新存储使用情况估算
        if (downloadedSize > 0) {
          updateLocalSize(fileId, downloadedSize);
        } else {
          // 如果无法计算具体大小，触发重新计算
          getStorageUsage();
        }
      } catch (error) {
        console.error("处理下载完成失败:", error);
        updateFile(fileId, {
          status: DownloadStatus.ERROR,
          error: error instanceof Error ? error.message : "未知错误",
        });
      }
    },
    [updateFile, getStorageUsage, updateLocalSize]
  );

  // 处理下载错误
  const handleDownloadError = useCallback(
    (payload: { fileId: string; chunkIndex: number; error: string }) => {
      const { fileId, error } = payload;

      updateFile(fileId, {
        status: DownloadStatus.ERROR,
        error,
      });

      // 移除处理中状态
      setProcessingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(fileId);
        return newSet;
      });

      // 显示错误消息
      message.error(`下载失败: ${error}`);
    },
    [updateFile]
  );

  // 处理合并完成
  const handleMergeComplete = useCallback(
    async (payload: { fileId: string; blob: Blob; size: number }) => {
      const { fileId, blob, size } = payload;

      try {
        // 确保存储已初始化
        await completeFileStore.ready();

        // 存储合并后的文件
        await completeFileStore.setItem(fileId, blob);

        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) {
          console.error(`处理合并完成失败: 未找到文件 ${fileId}`);
          return;
        }

        // 更新文件状态
        updateFile(fileId, {
          status: DownloadStatus.COMPLETED,
          progress: 100,
          completedAt: Date.now(),
        });

        // 保存到IndexedDB以确保刷新后能正确显示完成状态
        await fileStore.setItem(fileId, {
          ...file,
          status: DownloadStatus.COMPLETED,
          progress: 100,
          completedAt: Date.now(),
        });

        // 移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });

        // 更新存储使用情况估算
        console.log(`文件 ${fileId} 合并完成，大小：${size} 字节`);
        updateLocalSize(fileId, size);

        // 获取最新的存储使用情况
        setTimeout(() => {
          getStorageUsage();
        }, 500);
      } catch (error) {
        console.error("存储合并文件失败:", error);
        updateFile(fileId, {
          status: DownloadStatus.ERROR,
          error: "合并文件失败",
        });
      }
    },
    [updateFile, updateLocalSize, getStorageUsage]
  );

  // 处理合并错误
  const handleMergeError = useCallback(
    (payload: { fileId: string; error: string }) => {
      const { fileId, error } = payload;

      updateFile(fileId, {
        status: DownloadStatus.ERROR,
        error: `合并文件失败: ${error}`,
      });

      // 移除处理中状态
      setProcessingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(fileId);
        return newSet;
      });

      // 显示错误消息
      message.error(`合并文件失败: ${error}`);
    },
    [updateFile]
  );

  // 处理下载暂停
  const handleDownloadPaused = useCallback(
    async (payload: { fileId: string }) => {
      const { fileId } = payload;
      console.log(`确认下载已暂停: ${fileId}`);

      try {
        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) {
          console.error(`处理暂停失败: 未找到文件 ${fileId}`);
          return;
        }

        // 获取最新的分片信息，计算准确的进度
        await chunkStore.ready();
        let downloadedChunks = 0;
        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${fileId}_chunk_${i}`;
          const chunk = await chunkStore.getItem<Blob>(chunkId);
          if (chunk && chunk.size > 0) {
            downloadedChunks++;
          }
        }

        // 计算准确的进度
        const progress = Math.round(
          (downloadedChunks / file.totalChunks) * 100
        );

        console.log(
          `处理文件 ${file.fileName} 暂停, 已下载分片: ${downloadedChunks}/${file.totalChunks}, 计算进度: ${progress}%`
        );

        // 更新UI状态
        updateFile(fileId, {
          status: DownloadStatus.PAUSED,
          progress: progress,
          downloadedChunks: downloadedChunks,
        });

        // 保存到IndexedDB以确保刷新后能恢复进度
        await fileStore.setItem(fileId, {
          ...file,
          status: DownloadStatus.PAUSED,
          progress: progress,
          downloadedChunks: downloadedChunks,
        });

        console.log(
          `已将文件 ${file.fileName} 暂停状态和进度(${progress}%)保存到IndexedDB`
        );

        // 确保移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          console.log(`已从处理列表中移除文件 ${file.fileName}`);
          return newSet;
        });
      } catch (error) {
        console.error(`处理暂停失败:`, error);

        // 即使发生错误，也要尝试移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });
      }
    },
    [updateFile]
  );

  // 开始下载
  const startDownload = useCallback(
    async (file: DownloadFile) => {
      try {
        console.log(
          `开始下载文件: ${file.fileName}, 当前状态: ${file.status}, 进度: ${file.progress}%`
        );

        // 检查是否已在处理中
        if (processingFiles.has(file.id)) {
          console.log(`文件 ${file.fileName} 已在处理中，先移除再重新添加`);
          // 先移除再重新添加，确保状态正确
          setProcessingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file.id);
            return newSet;
          });
        }

        // 添加到处理中
        setProcessingFiles((prev) => new Set(prev).add(file.id));
        console.log(`已将文件 ${file.fileName} 添加到处理列表`);

        // 更新文件状态
        updateFile(file.id, {
          status: DownloadStatus.PREPARING,
          error: undefined,
        });
        console.log(`已更新文件 ${file.fileName} 状态为准备中`);

        // 确保存储已初始化
        await Promise.all([fileStore.ready(), chunkStore.ready()]);
        console.log(`存储已初始化`);

        // 检查已下载的分片
        const pendingChunks: number[] = [];
        let existingChunks = 0;
        let existingSize = 0;

        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${file.id}_chunk_${i}`;
          const chunk = await chunkStore.getItem<Blob>(chunkId);
          // 检查分片是否存在且有效
          if (!chunk || chunk.size === 0) {
            pendingChunks.push(i);
            console.log(`分片 ${i} 不存在或无效，添加到待下载列表`);
          } else {
            existingChunks++;
            existingSize += chunk.size;
            console.log(`分片 ${i} 已存在，大小: ${chunk.size} 字节`);
          }
        }

        console.log(
          `文件 ${file.fileName} 共有 ${file.totalChunks} 个分片，已下载 ${existingChunks} 个，待下载 ${pendingChunks.length} 个`
        );

        // 如果有已存在的分片，更新存储使用情况估算
        if (existingSize > 0) {
          console.log(
            `文件 ${file.fileName} 已有 ${existingSize} 字节的分片数据`
          );
          updateLocalSize(file.id, existingSize);
        }

        // 如果所有分片已下载，直接合并
        if (pendingChunks.length === 0) {
          console.log(`文件 ${file.fileName} 所有分片已下载，开始合并`);
          await mergeFile(file);
          return;
        }

        // 创建AbortController
        const controller = new AbortController();
        addAbortController(file.id, controller);
        console.log(`已为文件 ${file.fileName} 创建AbortController`);

        // 计算实际进度
        const calculatedProgress = Math.round(
          ((file.totalChunks - pendingChunks.length) / file.totalChunks) * 100
        );

        // 使用计算出的进度或保留现有进度（如果存在且合理）
        const progress =
          file.progress &&
          file.progress > 0 &&
          file.progress === calculatedProgress
            ? file.progress
            : calculatedProgress;

        console.log(
          `文件 ${file.fileName} 计算的进度: ${calculatedProgress}%, 最终使用的进度: ${progress}%`
        );

        // 更新文件状态
        updateFile(file.id, {
          status: DownloadStatus.DOWNLOADING,
          downloadedChunks: file.totalChunks - pendingChunks.length,
          progress: progress,
        });
        console.log(
          `已更新文件 ${file.fileName} 状态为下载中，进度: ${progress}%`
        );

        // 保存到IndexedDB
        await fileStore.setItem(file.id, {
          ...file,
          status: DownloadStatus.DOWNLOADING,
          downloadedChunks: file.totalChunks - pendingChunks.length,
          progress: progress,
        });
        console.log(`已将文件 ${file.fileName} 状态保存到IndexedDB`);

        // 估算待下载内容的大小
        const estimatedTotalSize = file.fileSize;
        const estimatedRemainingSize = Math.round(
          estimatedTotalSize * (pendingChunks.length / file.totalChunks)
        );
        console.log(
          `文件 ${file.fileName} 估计总大小: ${estimatedTotalSize} 字节，待下载大小: ${estimatedRemainingSize} 字节`
        );

        // 更新存储使用情况估算（预估即将下载的内容大小）
        updateLocalSize(file.id, estimatedRemainingSize);

        // 发送消息到Worker开始下载
        if (downloadWorkerRef.current) {
          console.log(
            `发送开始下载消息到Worker: ${file.fileName}, 待下载分片: ${pendingChunks.length}个`
          );
          downloadWorkerRef.current.postMessage({
            type: "START_DOWNLOAD",
            payload: {
              fileId: file.id,
              url: apiClient.createDownloadUrl(file.id),
              fileSize: file.fileSize,
              chunkSize: file.chunkSize || 5 * 1024 * 1024,
              totalChunks: file.totalChunks,
              pendingChunks,
            },
          });
        } else {
          throw new Error("下载Worker未初始化");
        }
      } catch (error) {
        console.error(`开始下载文件 ${file.fileName} 失败:`, error);

        updateFile(file.id, {
          status: DownloadStatus.ERROR,
          error: error instanceof Error ? error.message : "未知错误",
        });

        // 移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(file.id);
          return newSet;
        });

        // 显示错误消息
        message.error(
          `开始下载失败: ${error instanceof Error ? error.message : "未知错误"}`
        );
      }
    },
    [addAbortController, updateFile, updateLocalSize]
  );

  // 暂停下载
  const pauseDownload = useCallback(
    async (fileId: string) => {
      try {
        console.log(`尝试暂停下载: ${fileId}`);

        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) {
          console.error(`暂停失败: 未找到文件 ${fileId}`);
          return;
        }

        // 先发送消息到Worker
        if (downloadWorkerRef.current) {
          console.log(`发送暂停消息到Worker: ${fileId}`);
          downloadWorkerRef.current.postMessage({
            type: "PAUSE_DOWNLOAD",
            payload: { fileId },
          });
        }

        // 中止下载
        const controller = abortControllers[fileId];
        if (controller) {
          console.log(`中止下载请求: ${fileId}`);
          controller.abort();
          removeAbortController(fileId);
        } else {
          console.warn(`未找到对应的AbortController: ${fileId}`);
        }

        // 临时更新UI状态为"正在暂停"
        updateFile(fileId, {
          status: DownloadStatus.PAUSED,
          error: undefined, // 清除可能存在的错误信息
        });

        // 显示消息
        message.info(`正在暂停下载 ${file.fileName}...`);

        // 注意：实际的状态更新将在handleDownloadPaused中完成
        // 这样可以确保Worker完成当前操作并正确计算进度
        console.log(`已发送暂停命令: ${fileId}, 等待Worker确认`);
      } catch (error) {
        console.error("暂停下载失败:", error);
        message.error("暂停下载失败");
      }
    },
    [abortControllers, removeAbortController, updateFile]
  );

  // 继续下载
  const resumeDownload = useCallback(
    async (fileId: string) => {
      try {
        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) {
          console.error(`继续下载失败: 未找到文件 ${fileId}`);
          return;
        }

        console.log(
          `准备继续下载文件: ${file.fileName}, 当前进度: ${file.progress}%`
        );

        // 检查是否在处理中列表，如果在则先移除
        if (processingFiles.has(fileId)) {
          console.log(`文件 ${file.fileName} 在处理中列表中，先移除`);
          setProcessingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(fileId);
            return newSet;
          });
        }

        // 先更新UI状态
        updateFile(fileId, {
          status: DownloadStatus.PREPARING,
          error: undefined,
        });

        // 显示消息
        message.info(`继续下载 ${file.fileName}`);

        // 开始下载
        await startDownload(file);
      } catch (error) {
        console.error("继续下载失败:", error);
        message.error("继续下载失败");

        // 确保移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });
      }
    },
    [startDownload, updateFile, processingFiles]
  );

  // 取消下载
  const cancelDownload = useCallback(
    async (fileId: string) => {
      try {
        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) return;

        // 更新文件状态
        updateFile(fileId, {
          status: DownloadStatus.IDLE,
          progress: 0,
          downloadedChunks: 0,
        });

        // 中止下载
        const controller = abortControllers[fileId];
        if (controller) {
          controller.abort();
          removeAbortController(fileId);
        }

        // 发送消息到Worker
        if (downloadWorkerRef.current) {
          downloadWorkerRef.current.postMessage({
            type: "CANCEL",
            payload: { fileId },
          });
        }

        // 计算删除前的文件大小（用于更新存储估算）
        let fileSize = 0;
        // 计算分片大小
        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${fileId}_chunk_${i}`;
          const chunk = await chunkStore.getItem<Blob>(chunkId);
          if (chunk) {
            fileSize += chunk.size;
          }
        }
        // 计算完整文件大小
        const completeFile = await completeFileStore.getItem<Blob>(fileId);
        if (completeFile) {
          fileSize += completeFile.size;
        }

        console.log(
          `取消下载: 文件 ${file.fileName} 大小 ${fileSize} 字节将被删除`
        );

        // 删除所有分片
        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${fileId}_chunk_${i}`;
          await chunkStore.removeItem(chunkId);
        }

        // 删除完整文件
        await completeFileStore.removeItem(fileId);

        // 更新文件状态
        await fileStore.setItem(fileId, {
          ...file,
          status: DownloadStatus.IDLE,
          progress: 0,
          downloadedChunks: 0,
          error: undefined,
        });

        // 移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });

        // 更新存储使用情况估算（减去已删除的文件大小）
        if (fileSize > 0) {
          updateLocalSize(fileId, -fileSize);
        }

        // 显示消息
        message.info(`已取消下载 ${file.fileName}`);
      } catch (error) {
        console.error("取消下载失败:", error);
        message.error("取消下载失败");
      }
    },
    [abortControllers, removeAbortController, updateFile, updateLocalSize]
  );

  // 删除文件
  const deleteFile = useCallback(
    async (fileId: string) => {
      try {
        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) return;

        // 计算文件大小（用于更新存储估算）
        const fileSize = await calculateFileSize(fileId);
        console.log(`删除文件: ${file.fileName} 大小 ${fileSize} 字节`);

        // 取消下载
        await cancelDownload(fileId);

        // 删除文件信息
        await fileStore.removeItem(fileId);

        // 更新存储使用情况估算（减去已删除的文件大小）
        if (fileSize > 0) {
          updateLocalSize(fileId, -fileSize);
        } else {
          // 如果无法计算具体大小，触发重新计算
          getStorageUsage();
        }

        // 显示消息
        message.success(`已删除文件 ${file.fileName}`);
      } catch (error) {
        console.error("删除文件失败:", error);
        message.error("删除文件失败");
      }
    },
    [cancelDownload, calculateFileSize, updateLocalSize, getStorageUsage]
  );

  // 导出文件
  const exportFile = useCallback(async (file: DownloadFile) => {
    try {
      const success = await exportFileToLocal(file);

      if (success) {
        message.success(`文件 ${file.fileName} 导出成功`);
      } else {
        message.error(`文件 ${file.fileName} 导出失败`);
      }

      return success;
    } catch (error) {
      console.error("导出文件失败:", error);
      message.error("导出文件失败");
      return false;
    }
  }, []);

  // 合并文件
  const mergeFile = useCallback(
    async (file: DownloadFile) => {
      try {
        // 检查是否已在处理中
        if (processingFiles.has(file.id)) {
          return;
        }

        // 添加到处理中
        setProcessingFiles((prev) => new Set(prev).add(file.id));

        // 更新文件状态
        updateFile(file.id, { status: DownloadStatus.PREPARING });

        // 确保存储已初始化
        await Promise.all([chunkStore.ready(), completeFileStore.ready()]);

        // 检查是否已有合并后的文件
        const completeFile = await completeFileStore.getItem<Blob>(file.id);
        if (completeFile) {
          // 已有合并后的文件，直接完成
          updateFile(file.id, {
            status: DownloadStatus.COMPLETED,
            progress: 100,
            completedAt: Date.now(),
          });

          // 移除处理中状态
          setProcessingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file.id);
            return newSet;
          });

          return;
        }

        // 获取所有分片，并检查缺失的分片
        const chunks: Blob[] = [];
        const missingChunks: number[] = [];

        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${file.id}_chunk_${i}`;
          const chunk = await chunkStore.getItem<Blob>(chunkId);
          if (!chunk) {
            console.warn(`检测到分片 ${i} 不存在，将添加到缺失列表`);
            missingChunks.push(i);
          } else {
            chunks.push(chunk);
          }
        }

        // 如果有缺失的分片，尝试重新下载
        if (missingChunks.length > 0) {
          console.log(
            `文件 ${file.fileName} 有 ${missingChunks.length} 个分片缺失，尝试重新下载`
          );

          // 更新文件状态为需要继续下载
          updateFile(file.id, {
            status: DownloadStatus.PAUSED,
            downloadedChunks: file.totalChunks - missingChunks.length,
            progress: Math.round(
              ((file.totalChunks - missingChunks.length) / file.totalChunks) *
                100
            ),
          });

          // 保存到IndexedDB
          await fileStore.setItem(file.id, {
            ...file,
            status: DownloadStatus.PAUSED,
            downloadedChunks: file.totalChunks - missingChunks.length,
            progress: Math.round(
              ((file.totalChunks - missingChunks.length) / file.totalChunks) *
                100
            ),
          });

          // 移除处理中状态
          setProcessingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file.id);
            return newSet;
          });

          message.warning(
            `文件 ${file.fileName} 有部分分片缺失，请点击"继续"按钮重新下载`
          );
          return;
        }

        // 使用Worker合并文件
        if (mergeWorkerRef.current) {
          mergeWorkerRef.current.postMessage({
            type: "MERGE_FILE",
            payload: {
              fileId: file.id,
              totalChunks: file.totalChunks,
              mimeType: file.mimeType,
              chunks,
            },
          });
        } else {
          // 如果Worker不可用，在主线程合并
          const mergedBlob = await mergeFileChunks(file);
          await completeFileStore.setItem(file.id, mergedBlob);

          updateFile(file.id, {
            status: DownloadStatus.COMPLETED,
            progress: 100,
            completedAt: Date.now(),
          });

          // 保存到IndexedDB以确保刷新后能正确显示完成状态
          await fileStore.setItem(file.id, {
            ...file,
            status: DownloadStatus.COMPLETED,
            progress: 100,
            completedAt: Date.now(),
          });

          // 移除处理中状态
          setProcessingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file.id);
            return newSet;
          });
        }
      } catch (error) {
        console.error("合并文件失败:", error);

        updateFile(file.id, {
          status: DownloadStatus.ERROR,
          error: `合并文件失败: ${
            error instanceof Error ? error.message : "未知错误"
          }`,
        });

        // 移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(file.id);
          return newSet;
        });

        // 显示错误消息
        message.error(
          `合并文件失败: ${error instanceof Error ? error.message : "未知错误"}`
        );
      }
    },
    [updateFile]
  );

  // 重置处理中状态
  const resetProcessingState = useCallback(
    (fileId: string) => {
      if (processingFiles.has(fileId)) {
        console.log(`重置文件 ${fileId} 的处理中状态`);
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });
        return true;
      }
      return false;
    },
    [processingFiles]
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
