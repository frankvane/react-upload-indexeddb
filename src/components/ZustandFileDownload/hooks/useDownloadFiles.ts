import { DownloadFile, DownloadStatus } from "../types";
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
  const { files, fetchingFiles, setFiles, fetchDownloadFiles } =
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
    isInitialized: false, // 是否已初始化
  });

  // 更新本地文件状态
  const updateLocalFileStatus = useCallback(
    async (currentFiles?: DownloadFile[]) => {
      try {
        // 使用传入的文件列表或当前store中的文件列表
        const filesToProcess = currentFiles || files;

        // 如果没有文件，则不进行处理
        if (!filesToProcess || filesToProcess.length === 0) {
          console.log("没有文件需要更新本地状态");
          return;
        }

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
        const updatedFiles = filesToProcess.map((file: DownloadFile) => {
          const localFile = localFiles[file.id];

          if (localFile) {
            // 如果本地已有该文件的信息，保留其状态和进度
            return {
              ...file,
              downloadedChunks: localFile.downloadedChunks || 0,
              progress: localFile.progress || 0,
              status: localFile.status || DownloadStatus.IDLE,
              error: localFile.error,
              completedAt: localFile.completedAt,
            };
          }

          return file;
        });

        console.log("更新本地文件状态后的文件列表:", updatedFiles);
        setFiles(updatedFiles);
      } catch (error) {
        console.error("更新本地文件状态失败:", error);
      }
    },
    // 移除files依赖，避免死循环
    [setFiles]
  );

  // 获取文件列表
  const fetchFileList = useCallback(
    async (forceUpdate = false) => {
      try {
        console.log("fetchFileList被调用，forceUpdate:", forceUpdate);

        // 使用store中的方法获取服务器文件列表，并自动更新store中的files
        const downloadedFiles = await fetchDownloadFiles({}, forceUpdate);
        console.log(
          "fetchDownloadFiles返回结果:",
          downloadedFiles?.length || 0,
          "个文件"
        );

        // 获取本地存储的文件状态并合并
        if (downloadedFiles && downloadedFiles.length > 0) {
          console.log("开始更新本地文件状态...");
          await updateLocalFileStatus(downloadedFiles);
        } else {
          console.log("没有获取到文件或文件列表为空，跳过本地状态更新");
        }

        // 在文件列表初次加载时获取一次存储使用情况
        if (!prevState.current.isInitialized) {
          console.log("初次加载，触发存储使用情况更新");
          triggerStorageUpdate();
          prevState.current.isInitialized = true;
        }
      } catch (error) {
        console.error("获取文件列表失败:", error);
        message.error("获取文件列表失败，请检查网络连接");
      }
    },
    [fetchDownloadFiles, triggerStorageUpdate, updateLocalFileStatus]
  );

  // 初始化时加载文件列表，使用空依赖数组确保只执行一次
  useEffect(() => {
    console.log("初始化加载文件列表");
    fetchFileList(true); // 强制更新，确保获取最新数据
  }, []); // 空依赖数组，确保只执行一次

  // 在文件列表变化时更新存储使用情况，添加防抖处理
  useEffect(() => {
    // 如果文件列表为空，不处理
    if (!files || files.length === 0) return;

    // 只在文件列表发生重大变化时更新存储使用情况
    // 例如：文件数量变化、下载完成、删除文件等
    const completedFiles = files.filter(
      (file) => file.status === DownloadStatus.COMPLETED
    ).length;
    const downloadingFiles = files.filter(
      (file) => file.status === DownloadStatus.DOWNLOADING
    ).length;

    // 检查是否有实质性变化
    const hasSignificantChanges =
      prevState.current.totalFiles !== files.length ||
      prevState.current.completedFiles !== completedFiles ||
      Math.abs(prevState.current.downloadingFiles - downloadingFiles) > 1;

    if (hasSignificantChanges) {
      console.log("文件列表发生重大变化，更新存储使用情况");
      // 使用triggerStorageUpdate替代getStorageUsage，这样可以避免多次触发
      triggerStorageUpdate();

      // 更新上一次状态
      prevState.current = {
        ...prevState.current,
        totalFiles: files.length,
        completedFiles,
        downloadingFiles,
        lastUpdateTime: Date.now(),
      };
    }
  }, [files, triggerStorageUpdate]);

  // 监听store中的chunkSize变化，当变化时重新获取文件列表
  useEffect(() => {
    // 获取初始chunkSize
    const initialChunkSize = useDownloadStore.getState().chunkSize;
    prevState.current.chunkSize = initialChunkSize;

    // 创建订阅函数，监听状态变化
    const unsubscribe = useDownloadStore.subscribe((state) => {
      const currentChunkSize = state.chunkSize;
      const prevChunkSize = prevState.current.chunkSize;

      // 如果chunkSize变化了且不是初始值，重新获取文件列表
      if (prevChunkSize !== 0 && prevChunkSize !== currentChunkSize) {
        console.log(
          `检测到chunkSize变化: ${prevChunkSize} -> ${currentChunkSize}，重新获取文件列表`
        );
        // 更新prevState中的chunkSize
        prevState.current.chunkSize = currentChunkSize;
        // 使用forceUpdate参数强制更新文件列表
        fetchFileList(true);
      }
    });

    // 组件卸载时取消订阅
    return () => {
      unsubscribe();
    };
  }, [fetchFileList]);

  return {
    files,
    fetchingFiles,
    fetchFileList,
  };
};
