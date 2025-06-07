/* eslint-disable @typescript-eslint/no-unused-vars */

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
  const { getStorageUsage, triggerStorageUpdate } = useStorageManager();

  // 下载Worker引用
  const downloadWorkerRef = useRef<Worker | null>(null);
  const mergeWorkerRef = useRef<Worker | null>(null);

  // 正在处理的文件
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(
    new Set()
  );

  // 存储每个文件上次进度更新的时间和值
  const lastProgressUpdate = useRef<
    Record<string, { time: number; progress: number }>
  >({});

  // 进度更新最小间隔（毫秒）
  const PROGRESS_UPDATE_INTERVAL = 300;
  // 进度变化阈值（百分比）
  const PROGRESS_CHANGE_THRESHOLD = 5;

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
            if (typeof updateFile === "function") {
              updateFile(payload.fileId, { status: DownloadStatus.PAUSED });
            }

            setProcessingFiles((prev) => {
              const newSet = new Set(prev);
              newSet.delete(payload.fileId);
              return newSet;
            });
          }
          break;
        case "RESUMED":
          break;
        case "CANCELLED":
          break;
        default:
      }
    };

    // 设置合并Worker消息处理
    mergeWorker.onmessage = async (event) => {
      const { type, payload } = event.data;

      switch (type) {
        case "MERGE_COMPLETE":
          await handleMergeComplete(payload);
          break;
        case "ERROR":
          handleMergeError(payload);
          break;
        default:
      }
    };

    // 清理函数
    return () => {
      downloadWorker.terminate();
      mergeWorker.terminate();
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
      const now = Date.now();

      // 获取上次更新信息
      const lastUpdate = lastProgressUpdate.current[fileId] || {
        time: 0,
        progress: -1,
      };

      // 计算进度变化
      const progressChange = Math.abs(progress - lastUpdate.progress);
      const timeSinceLastUpdate = now - lastUpdate.time;

      // 更新条件：
      // 1. 是首次进度更新 (progress=0)
      // 2. 是最终进度更新 (progress=100)
      // 3. 进度变化大于阈值
      // 4. 距离上次更新时间已超过间隔
      const shouldUpdate =
        lastUpdate.progress === -1 || // 首次更新
        progress === 0 || // 初始进度
        progress === 100 || // 完成时始终更新
        progressChange >= PROGRESS_CHANGE_THRESHOLD || // 进度变化大时更新
        timeSinceLastUpdate >= PROGRESS_UPDATE_INTERVAL; // 时间间隔足够长时更新

      if (shouldUpdate) {
        // 只在需要时更新UI，减少不必要的渲染
        updateFile(fileId, {
          progress,
          downloadedChunks,
          status: DownloadStatus.DOWNLOADING,
        });

        // 更新最后一次进度信息
        lastProgressUpdate.current[fileId] = {
          time: now,
          progress,
        };

        // 调试信息
        if (progress < 100) {
          console.log(
            `更新进度: ${progress}%, 变化: ${progressChange}%, 间隔: ${timeSinceLastUpdate}ms`
          );
        }
      }
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

          success = true;
        } catch (_) {
          retryCount++;
          if (retryCount >= maxRetries) {
            console.error(`分片 ${chunkIndex} 存储失败，已达到最大重试次数`);
            // 可以在这里添加额外的错误处理，如通知主线程
          } else {
            // 短暂延迟后重试
            await new Promise((resolve) => setTimeout(resolve, 500));
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
        console.log(`处理文件下载完成: ${fileId}`);
        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) {
          console.error(`处理下载完成失败: 未找到文件 ${fileId}`);
          return;
        }

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
          // 删除损坏的分片，以便重新下载
          for (const chunkIndex of corruptChunks) {
            const chunkId = `${fileId}_chunk_${chunkIndex}`;
            await chunkStore.removeItem(chunkId);
          }

          // 更新文件状态为需要继续下载
          const totalProblemChunks = problemChunks.length;
          const completedChunks = file.totalChunks - totalProblemChunks;
          const progress = Math.round(
            (completedChunks / file.totalChunks) * 100
          );

          // 准备更新对象，之后一次性更新状态
          const fileUpdate = {
            status: DownloadStatus.PAUSED,
            downloadedChunks: completedChunks,
            progress: progress,
            error: `有${totalProblemChunks}个分片问题（缺失: ${missingChunks.length}, 损坏: ${corruptChunks.length}），请点击"继续"按钮重新下载`,
          };

          // 更新UI状态和存储状态 (只触发一次状态更新)
          updateFile(fileId, fileUpdate);

          // 保存到IndexedDB
          await fileStore.setItem(fileId, {
            ...file,
            ...fileUpdate,
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

        // 所有分片都存在且有效，准备一次性更新文件状态
        const completedAt = Date.now();
        const fileUpdate = {
          status: DownloadStatus.COMPLETED,
          progress: 100,
          completedAt,
        };

        // 更新UI状态 (只触发一次状态更新)
        updateFile(fileId, fileUpdate);

        // 保存到IndexedDB以确保刷新后能正确显示完成状态
        await fileStore.setItem(fileId, {
          ...file,
          ...fileUpdate,
        });

        // 移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });

        // 文件下载完成后，触发存储使用情况更新（关键时机1：上传完成）
        // console.log(`文件 ${file.fileName} 下载完成，更新存储统计`);
        getStorageUsage(true);

        // 显示成功消息
        // message.success(`文件 ${file.fileName} 下载完成`);
      } catch (err) {
        console.error("处理下载完成失败:", err);
        updateFile(fileId, {
          status: DownloadStatus.ERROR,
          error: err instanceof Error ? err.message : "未知错误",
        });
      }
    },
    [updateFile, getStorageUsage]
  );

  // 处理下载错误
  const handleDownloadError = useCallback(
    (payload: { fileId: string; chunkIndex: number; error: string }) => {
      const { fileId, error: errorMessage } = payload;

      updateFile(fileId, {
        status: DownloadStatus.ERROR,
        error: errorMessage,
      });

      // 移除处理中状态
      setProcessingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(fileId);
        return newSet;
      });

      // 显示错误消息
      message.error(`下载失败: ${errorMessage}`);
    },
    [updateFile]
  );

  // 处理合并完成
  const handleMergeComplete = useCallback(
    async (payload: { fileId: string; blob: Blob }) => {
      const { fileId, blob } = payload;

      try {
        console.log(`处理文件合并完成: ${fileId}`);
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

        // 准备一次性更新文件状态
        const completedAt = Date.now();
        const fileUpdate = {
          status: DownloadStatus.COMPLETED,
          progress: 100,
          completedAt,
        };

        // 更新UI状态 (只触发一次状态更新)
        updateFile(fileId, fileUpdate);

        // 保存到IndexedDB以确保刷新后能正确显示完成状态
        await fileStore.setItem(fileId, {
          ...file,
          ...fileUpdate,
        });

        // 移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });

        // 文件合并完成后，触发存储使用情况更新（关键时机1：上传完成）
        console.log(`文件 ${file.fileName} 合并完成，更新存储统计`);
        getStorageUsage(true);

        // 显示成功消息
        // message.success(`文件 ${file.fileName} 下载完成`);
      } catch (err) {
        console.error("处理合并完成失败:", err);
      }
    },
    [updateFile, getStorageUsage]
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

        // 确保移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });
      } catch (err) {
        console.error(`处理暂停失败:`, err);

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
        // 标记为处理中
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.add(file.id);
          return newSet;
        });

        // 更新文件状态为准备中
        updateFile(file.id, {
          status: DownloadStatus.PREPARING,
          error: undefined,
        });

        // 确保存储已初始化
        await Promise.all([fileStore.ready(), chunkStore.ready()]);

        // 检查已下载的分片
        const pendingChunks: number[] = [];
        let existingSize = 0;

        for (let i = 0; i < file.totalChunks; i++) {
          const chunkId = `${file.id}_chunk_${i}`;
          const chunk = await chunkStore.getItem<Blob>(chunkId);
          // 检查分片是否存在且有效
          if (!chunk || chunk.size === 0) {
            pendingChunks.push(i);
          } else {
            existingSize += chunk.size;
          }
        }

        // 如果所有分片已下载，直接合并
        if (pendingChunks.length === 0) {
          // 直接调用mergeFile，不要在依赖项中声明它以避免循环引用
          await mergeFile(file);
          return;
        }

        // 创建AbortController
        const controller = new AbortController();
        addAbortController(file.id, controller);

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

        // 更新文件状态
        updateFile(file.id, {
          status: DownloadStatus.DOWNLOADING,
          downloadedChunks: file.totalChunks - pendingChunks.length,
          progress: progress,
        });

        // 保存到IndexedDB
        await fileStore.setItem(file.id, {
          ...file,
          status: DownloadStatus.DOWNLOADING,
          downloadedChunks: file.totalChunks - pendingChunks.length,
          progress: progress,
        });

        // 发送消息到Worker开始下载
        if (downloadWorkerRef.current) {
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
      } catch (err) {
        console.error(`开始下载文件 ${file.fileName} 失败:`, err);

        updateFile(file.id, {
          status: DownloadStatus.ERROR,
          error: err instanceof Error ? err.message : "未知错误",
        });

        // 移除处理中状态
        setProcessingFiles((prev) => {
          const newSet = new Set(prev);
          newSet.delete(file.id);
          return newSet;
        });

        // 显示错误消息
        message.error(
          `开始下载失败: ${err instanceof Error ? err.message : "未知错误"}`
        );
      }
    },
    [addAbortController, updateFile]
  );

  // 暂停下载
  const pauseDownload = useCallback(
    async (fileId: string) => {
      try {
        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) {
          console.error(`暂停失败: 未找到文件 ${fileId}`);
          return;
        }

        // 先发送消息到Worker
        if (downloadWorkerRef.current) {
          downloadWorkerRef.current.postMessage({
            type: "PAUSE_DOWNLOAD",
            payload: { fileId },
          });
        }

        // 中止下载
        const controller = abortControllers[fileId];
        if (controller) {
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
      } catch (err) {
        console.error("暂停下载失败:", err);
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

        // 检查是否在处理中列表，如果在则先移除
        if (processingFiles.has(fileId)) {
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
      } catch (err) {
        console.error("继续下载失败:", err);
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
    async (fileId: string, updateStorage = true) => {
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

        // 只在需要时更新存储统计
        if (updateStorage) {
          console.log(`文件 ${file.fileName} 已取消下载，更新存储统计`);
          getStorageUsage(true);
        }
      } catch (err) {
        console.error("取消下载失败:", err);
        message.error("取消下载失败");
      }
    },
    [abortControllers, removeAbortController, updateFile, getStorageUsage]
  );

  // 删除文件
  const deleteFile = useCallback(
    async (fileId: string) => {
      try {
        // 获取文件信息
        const file = await fileStore.getItem<DownloadFile>(fileId);
        if (!file) return;

        // 取消下载，但不触发存储更新
        await cancelDownload(fileId, false);

        // 删除文件信息
        await fileStore.removeItem(fileId);

        // 文件删除后，触发存储使用情况更新（关键时机2：删除文件）
        console.log(`文件 ${file.fileName} 已删除，更新存储统计`);
        getStorageUsage(true);

        // 显示消息
        // message.error(`文件 ${file.fileName} 成功删除`);
      } catch (err) {
        console.error("删除文件失败:", err);
        message.error("删除文件失败");
      }
    },
    [cancelDownload, getStorageUsage]
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
    } catch (err) {
      console.error("导出文件失败:", err);
      message.error("导出文件失败");
      return false;
    }
  }, []);

  // 合并文件
  const mergeFile = useCallback(
    async (file: DownloadFile) => {
      try {
        console.log(`开始合并文件: ${file.id}`);
        // 检查是否已在处理中
        if (processingFiles.has(file.id)) {
          console.log(`文件 ${file.id} 已在处理中，跳过合并`);
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
          console.log(`文件 ${file.id} 已存在合并后的文件，直接标记为完成`);
          // 已有合并后的文件，直接完成
          const fileUpdate = {
            status: DownloadStatus.COMPLETED,
            progress: 100,
            completedAt: Date.now(),
          };

          updateFile(file.id, fileUpdate);

          // 保存到IndexedDB
          await fileStore.setItem(file.id, {
            ...file,
            ...fileUpdate,
          });

          // 移除处理中状态
          setProcessingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file.id);
            return newSet;
          });

          // 文件完成后更新存储统计（关键时机1：上传完成）
          console.log(`文件 ${file.fileName} 标记为完成，更新存储统计`);
          getStorageUsage(true);

          // 显示成功消息
          // message.success(`文件 ${file.fileName} 下载完成`);
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
            `文件 ${file.id} 有 ${missingChunks.length} 个分片缺失，需要重新下载`
          );
          // 更新文件状态为需要继续下载
          const fileUpdate = {
            status: DownloadStatus.PAUSED,
            downloadedChunks: file.totalChunks - missingChunks.length,
            progress: Math.round(
              ((file.totalChunks - missingChunks.length) / file.totalChunks) *
                100
            ),
          };

          updateFile(file.id, fileUpdate);

          // 保存到IndexedDB
          await fileStore.setItem(file.id, {
            ...file,
            ...fileUpdate,
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
          console.log(`使用Worker合并文件: ${file.id}`);
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
          console.log(`Worker不可用，在主线程合并文件: ${file.id}`);
          // 如果Worker不可用，在主线程合并
          const mergedBlob = await mergeFileChunks(file);
          await completeFileStore.setItem(file.id, mergedBlob);

          const fileUpdate = {
            status: DownloadStatus.COMPLETED,
            progress: 100,
            completedAt: Date.now(),
          };

          updateFile(file.id, fileUpdate);

          // 保存到IndexedDB以确保刷新后能正确显示完成状态
          await fileStore.setItem(file.id, {
            ...file,
            ...fileUpdate,
          });

          // 移除处理中状态
          setProcessingFiles((prev) => {
            const newSet = new Set(prev);
            newSet.delete(file.id);
            return newSet;
          });

          // 文件合并完成后更新存储统计（关键时机1：上传完成）
          console.log(`文件 ${file.fileName} 在主线程合并完成，更新存储统计`);
          getStorageUsage(true);

          // 显示成功消息
          // message.success(`文件 ${file.fileName} 下载完成`);
        }
      } catch (err) {
        console.error("合并文件失败:", err);

        updateFile(file.id, {
          status: DownloadStatus.ERROR,
          error: `合并文件失败: ${
            err instanceof Error ? err.message : "未知错误"
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
          `合并文件失败: ${err instanceof Error ? err.message : "未知错误"}`
        );
      }
    },
    [updateFile, getStorageUsage]
  );

  // 重置处理中状态
  const resetProcessingState = useCallback(
    (fileId: string) => {
      if (processingFiles.has(fileId)) {
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
