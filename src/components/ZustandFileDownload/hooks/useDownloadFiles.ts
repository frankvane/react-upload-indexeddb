import * as apiClient from "../api.client.js";

import { CHUNK_SIZE, DownloadFile, DownloadStatus } from "../types";
import { useCallback, useEffect } from "react";

import { chunkStore } from "../utils";
import { completeFileStore } from "../utils";
import { fileStore } from "../utils";
import { message } from "antd";
import { useDownloadStore } from "../store";

/**
 * 文件列表管理Hook
 */
export const useDownloadFiles = () => {
  const { files, fetchingFiles, setFiles, setFetchingFiles } =
    useDownloadStore();

  // 获取文件列表
  const fetchFileList = useCallback(async () => {
    try {
      setFetchingFiles(true);

      // 获取服务器文件列表
      const downloadFiles = await apiClient.getDownloadFiles();
      console.log("已从服务器获取文件列表:", downloadFiles.length);

      // 获取本地存储的文件状态
      const localFiles: Record<string, DownloadFile> = {};
      const keys = await fileStore.keys();

      for (const key of keys) {
        const storedFile = await fileStore.getItem<DownloadFile>(key);
        if (storedFile) {
          localFiles[key] = storedFile;

          // 如果页面刷新前文件正在下载，改为暂停状态以便用户继续
          if (storedFile.status === DownloadStatus.DOWNLOADING) {
            console.log(
              `文件 ${storedFile.fileName} 在刷新前正在下载，改为暂停状态`
            );
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

            console.log(
              `更新文件 ${storedFile.fileName} 的进度为 ${progress}%，已下载分片 ${downloadedChunks}/${storedFile.totalChunks}`
            );

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
              console.log(`文件 ${storedFile.fileName} 已完成下载，更新状态`);
              storedFile.status = DownloadStatus.COMPLETED;
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
                console.log(`根据分片计算进度: ${storedFile.progress}%`);
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
                console.log(
                  `重新计算分片进度: ${storedFile.progress}%，已下载分片 ${downloadedChunks}/${storedFile.totalChunks}`
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

          if (localFile) {
            // 如果本地已有该文件的信息，保留其状态和进度
            return {
              ...file,
              totalChunks:
                localFile.totalChunks || Math.ceil(file.fileSize / CHUNK_SIZE),
              downloadedChunks: localFile.downloadedChunks || 0,
              progress: localFile.progress || 0,
              status: localFile.status || DownloadStatus.IDLE,
              error: localFile.error,
              completedAt: localFile.completedAt,
            };
          } else {
            // 新文件，设置初始状态
            return {
              ...file,
              totalChunks: Math.ceil(file.fileSize / CHUNK_SIZE),
              downloadedChunks: 0,
              progress: 0,
              status: DownloadStatus.IDLE,
            };
          }
        })
      );

      console.log("已更新文件列表，合并了本地状态");
    } catch (error) {
      console.error("获取文件列表失败:", error);
      message.error("获取文件列表失败，请检查网络连接");
    } finally {
      setFetchingFiles(false);
    }
  }, [setFetchingFiles, setFiles]);

  // 初始化时加载文件列表
  useEffect(() => {
    fetchFileList();
  }, [fetchFileList]);

  return {
    files,
    fetchingFiles,
    refreshFiles: fetchFileList,
  };
};
