import * as apiClient from "../api.client.js";

import { CHUNK_SIZE, DownloadFile, DownloadStatus } from "../types";
import { fileStore, getStoredFiles } from "../utils";
import { useCallback, useEffect } from "react";

import { chunkStore } from "../utils";
import { message } from "antd";
import { useDownloadStore } from "../store";

/**
 * 文件列表管理Hook
 */
export const useDownloadFiles = () => {
  const {
    files,
    storedFiles,
    fetchingFiles,
    setFiles,
    setStoredFiles,
    setFetchingFiles,
  } = useDownloadStore();

  // 获取文件列表
  const fetchFileList = useCallback(async () => {
    try {
      setFetchingFiles(true);
      const downloadFiles = await apiClient.getDownloadFiles();

      // 获取本地存储的文件状态
      const localFiles: Record<string, DownloadFile> = {};
      const keys = await fileStore.keys();

      for (const key of keys) {
        const storedFile = await fileStore.getItem<DownloadFile>(key);
        if (storedFile) {
          localFiles[key] = storedFile;
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
    } catch (error) {
      console.error("获取文件列表失败:", error);
      message.error("获取文件列表失败，请检查网络连接");
    } finally {
      setFetchingFiles(false);
    }
  }, [setFetchingFiles, setFiles]);

  // 获取已存储的文件
  const fetchStoredFiles = useCallback(async () => {
    try {
      console.log("获取已存储文件...");
      const storedFilesData = await getStoredFiles();
      console.log("已获取到存储文件:", storedFilesData.length);

      // 检查文件下载状态，确保中断状态的文件能继续下载
      for (const fileData of storedFilesData) {
        console.log(
          `处理文件: ${fileData.fileName}, 状态: ${fileData.status}, 进度: ${fileData.progress}%`
        );

        // 如果页面刷新前文件正在下载，改为暂停状态以便用户继续
        if (fileData.status === DownloadStatus.DOWNLOADING) {
          console.log(
            `文件 ${fileData.fileName} 在刷新前正在下载，改为暂停状态`
          );
          fileData.status = DownloadStatus.PAUSED;

          // 确保进度信息准确
          await chunkStore.ready();
          let downloadedChunks = 0;
          for (let i = 0; i < fileData.totalChunks; i++) {
            const chunkId = `${fileData.id}_chunk_${i}`;
            const chunk = await chunkStore.getItem<Blob>(chunkId);
            if (chunk && chunk.size > 0) {
              downloadedChunks++;
            }
          }

          // 计算准确的进度
          const progress = Math.round(
            (downloadedChunks / fileData.totalChunks) * 100
          );
          fileData.progress = progress;
          fileData.downloadedChunks = downloadedChunks;

          console.log(
            `更新文件 ${fileData.fileName} 的进度为 ${progress}%，已下载分片 ${downloadedChunks}/${fileData.totalChunks}`
          );

          await fileStore.setItem(fileData.id, fileData);
        }

        // 确保暂停的文件显示正确的进度
        if (fileData.status === DownloadStatus.PAUSED) {
          console.log(
            `确保暂停文件 ${fileData.fileName} 显示正确进度: ${fileData.progress}%`
          );

          // 确保进度属性存在
          if (fileData.progress === undefined || fileData.progress === null) {
            // 如果没有进度信息，根据已下载分片计算
            if (
              fileData.downloadedChunks !== undefined &&
              fileData.totalChunks !== undefined
            ) {
              fileData.progress = Math.round(
                (fileData.downloadedChunks / fileData.totalChunks) * 100
              );
              console.log(`根据分片计算进度: ${fileData.progress}%`);
            } else {
              // 如果没有分片信息，重新计算
              await chunkStore.ready();
              let downloadedChunks = 0;
              for (let i = 0; i < fileData.totalChunks; i++) {
                const chunkId = `${fileData.id}_chunk_${i}`;
                const chunk = await chunkStore.getItem<Blob>(chunkId);
                if (chunk && chunk.size > 0) {
                  downloadedChunks++;
                }
              }

              fileData.downloadedChunks = downloadedChunks;
              fileData.progress = Math.round(
                (downloadedChunks / fileData.totalChunks) * 100
              );
              console.log(
                `重新计算分片进度: ${fileData.progress}%，已下载分片 ${downloadedChunks}/${fileData.totalChunks}`
              );
            }

            // 更新存储
            await fileStore.setItem(fileData.id, fileData);
          }
        }
      }

      setStoredFiles(storedFilesData);
      console.log("已更新存储文件列表");
    } catch (error) {
      console.error("获取已存储文件失败:", error);
      message.error("获取已存储文件失败");
    }
  }, [setStoredFiles]);

  // 初始化时加载文件列表
  useEffect(() => {
    fetchFileList();
    fetchStoredFiles();
  }, [fetchFileList, fetchStoredFiles]);

  return {
    files,
    storedFiles,
    fetchingFiles,
    refreshFiles: fetchFileList,
    refreshStoredFiles: fetchStoredFiles,
  };
};
