import * as apiClient from "../api.client.js";

import { CHUNK_SIZE, DownloadFile, DownloadStatus } from "../types";
import { useCallback, useEffect, useRef } from "react";

import { chunkStore } from "../utils";
import { completeFileStore } from "../utils";
import { fileStore } from "../utils";
import { message } from "antd";
import { useDownloadStore } from "../store";
import { useStorageManager } from "./useStorageManager";

/**
 * 文件列表管理Hook
 */
export const useDownloadFiles = () => {
  const { files, fetchingFiles, setFiles, setFetchingFiles } =
    useDownloadStore();

  // 使用存储管理Hook
  const { triggerStorageUpdate } = useStorageManager();

  // 使用ref保存上一次文件状态，用于比较变化
  const prevState = useRef({
    totalFiles: 0,
    completedFiles: 0,
    downloadingFiles: 0,
    lastUpdateTime: 0, // 上次更新时间
    chunkSize: 0, // 上次的chunkSize
  });

  // 获取文件列表
  const fetchFileList = useCallback(async () => {
    try {
      setFetchingFiles(true);

      // 获取服务器文件列表
      const downloadFiles = await apiClient.getDownloadFiles();

      // 获取store中的chunkSize
      const { chunkSize: storeChunkSize } = useDownloadStore.getState();
      // 确定要使用的chunkSize，优先使用store中的设置，否则使用默认值
      const finalChunkSize = storeChunkSize || CHUNK_SIZE;

      // 获取本地存储的文件状态
      const localFiles: Record<string, DownloadFile> = {};
      const keys = await fileStore.keys();

      for (const key of keys) {
        const storedFile = await fileStore.getItem<DownloadFile>(key);
        if (storedFile) {
          localFiles[key] = storedFile;

          // 如果页面刷新前文件正在下载，改为暂停状态以便用户继续
          if (storedFile.status === DownloadStatus.DOWNLOADING) {
            storedFile.status = DownloadStatus.PAUSED;

            // 确保进度信息准确
            await chunkStore.ready();
            let downloadedChunks = 0;
            for (let i = 0; i < storedFile.totalChunks; i++) {
              const chunkId = `${storedFile.id}_chunk_${i}`;
              const chunk = await chunkStore.getItem<Blob>(chunkId);
              if (chunk && chunk.size > 0) {
                downloadedChunks++;
              }
            }

            // 计算准确的进度
            const progress = Math.round(
              (downloadedChunks / storedFile.totalChunks) * 100
            );
            storedFile.progress = progress;
            storedFile.downloadedChunks = downloadedChunks;

            await fileStore.setItem(storedFile.id, storedFile);
            localFiles[key] = storedFile;
          }

          // 检查是否是已完成的文件
          if (
            storedFile.status === DownloadStatus.PAUSED &&
            storedFile.progress === 100
          ) {
            // 检查是否有完整文件
            const completeFile = await completeFileStore.getItem<Blob>(
              storedFile.id
            );
            if (completeFile && completeFile.size > 0) {
              storedFile.status = DownloadStatus.COMPLETED;
              storedFile.completedAt = storedFile.completedAt || Date.now();
              await fileStore.setItem(storedFile.id, storedFile);
              localFiles[key] = storedFile;
            }
          }

          // 确保暂停的文件显示正确的进度
          if (storedFile.status === DownloadStatus.PAUSED) {
            // 确保进度属性存在
            if (
              storedFile.progress === undefined ||
              storedFile.progress === null
            ) {
              // 如果没有进度信息，根据已下载分片计算
              if (
                storedFile.downloadedChunks !== undefined &&
                storedFile.totalChunks !== undefined
              ) {
                storedFile.progress = Math.round(
                  (storedFile.downloadedChunks / storedFile.totalChunks) * 100
                );
              } else {
                // 如果没有分片信息，重新计算
                await chunkStore.ready();
                let downloadedChunks = 0;
                for (let i = 0; i < storedFile.totalChunks; i++) {
                  const chunkId = `${storedFile.id}_chunk_${i}`;
                  const chunk = await chunkStore.getItem<Blob>(chunkId);
                  if (chunk && chunk.size > 0) {
                    downloadedChunks++;
                  }
                }

                storedFile.downloadedChunks = downloadedChunks;
                storedFile.progress = Math.round(
                  (downloadedChunks / storedFile.totalChunks) * 100
                );
              }

              // 更新存储
              await fileStore.setItem(storedFile.id, storedFile);
              localFiles[key] = storedFile;
            }
          }
        }
      }

      // 合并服务器文件列表与本地状态
      setFiles(
        downloadFiles.map((file: any) => {
          const localFile = localFiles[file.id];
          // 确定要使用的chunkSize
          const fileChunkSize = localFile?.chunkSize || finalChunkSize;
          // 正确计算总分片数
          const calculatedTotalChunks = Math.ceil(
            file.fileSize / fileChunkSize
          );

          if (localFile) {
            // 如果本地已有该文件的信息，保留其状态和进度
            // 但要确保totalChunks是根据正确的chunkSize计算的
            return {
              ...file,
              totalChunks: calculatedTotalChunks,
              downloadedChunks: localFile.downloadedChunks || 0,
              progress: localFile.progress || 0,
              status: localFile.status || DownloadStatus.IDLE,
              error: localFile.error,
              completedAt: localFile.completedAt,
              chunkSize: fileChunkSize, // 确保使用已保存的chunkSize或新的finalChunkSize
            };
          } else {
            // 新文件，设置初始状态
            return {
              ...file,
              totalChunks: calculatedTotalChunks,
              downloadedChunks: 0,
              progress: 0,
              status: DownloadStatus.IDLE,
              chunkSize: fileChunkSize, // 为新文件设置chunkSize
            };
          }
        })
      );

      // 在文件列表初次加载时获取一次存储使用情况
      if (prevState.current.totalFiles === 0) {
        triggerStorageUpdate();
      }
    } catch {
      message.error("获取文件列表失败，请检查网络连接");
    } finally {
      setFetchingFiles(false);
    }
  }, [setFetchingFiles, setFiles, triggerStorageUpdate]);

  // 初始化时加载文件列表
  useEffect(() => {
    fetchFileList();
  }, [fetchFileList]);

  // 在文件列表变化时更新存储使用情况
  useEffect(() => {
    // 只在文件列表发生重大变化时更新存储使用情况
    // 例如：文件数量变化、下载完成、删除文件等
    const completedFiles = files.filter(
      (file) => file.status === DownloadStatus.COMPLETED
    ).length;
    const downloadingFiles = files.filter(
      (file) => file.status === DownloadStatus.DOWNLOADING
    ).length;

    if (
      prevState.current.totalFiles !== files.length ||
      prevState.current.completedFiles !== completedFiles ||
      Math.abs(prevState.current.downloadingFiles - downloadingFiles) > 1
    ) {
      // 使用triggerStorageUpdate替代getStorageUsage，这样可以避免多次触发
      triggerStorageUpdate();

      // 更新上一次状态
      prevState.current = {
        totalFiles: files.length,
        completedFiles,
        downloadingFiles,
        lastUpdateTime: Date.now(),
        chunkSize: prevState.current.chunkSize,
      };
    }
  }, [files, triggerStorageUpdate]);

  // 记录文件状态变化
  useEffect(() => {
    // 记录暂停文件的进度
    const pausedFiles = files.filter((file) => file.status === "paused");
    if (pausedFiles.length > 0) {
      // 暂停文件状态监控
    }
  }, [files]);

  // 监听store中的chunkSize变化，当变化时重新获取文件列表
  useEffect(() => {
    // 创建订阅函数
    const unsubscribe = useDownloadStore.subscribe(
      (state) => state.chunkSize,
      (currentChunkSize) => {
        const prevChunkSize = prevState.current.chunkSize;
        // 如果chunkSize变化了且不是初始值，重新获取文件列表
        if (prevChunkSize !== 0 && prevChunkSize !== currentChunkSize) {
          console.log(
            `检测到chunkSize变化: ${prevChunkSize} -> ${currentChunkSize}，重新获取文件列表`
          );
          // 更新prevState中的chunkSize
          prevState.current.chunkSize = currentChunkSize;
          fetchFileList();
        }
      }
    );

    // 组件卸载时取消订阅
    return () => unsubscribe();
  }, [fetchFileList]);

  // 刷新文件列表
  const refreshFiles = useCallback(async () => {
    await fetchFileList();
  }, [fetchFileList]);

  return {
    files,
    fetchingFiles,
    refreshFiles,
  };
};
