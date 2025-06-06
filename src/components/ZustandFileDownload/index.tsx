import * as apiClient from "./api.client.js";

import {
  Button,
  Card,
  List,
  Modal,
  Progress,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  FileOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import React, { useCallback, useEffect, useState } from "react";

import localforage from "localforage";

const { Title, Text, Paragraph } = Typography;

// 初始化IndexedDB存储
const fileStore = localforage.createInstance({
  name: "fileDownloadTest",
  storeName: "files",
  description: "用于测试大文件下载存储",
});

// 初始化分片存储
const chunkStore = localforage.createInstance({
  name: "fileDownloadTest",
  storeName: "chunks",
  description: "用于存储文件分片",
});

// 初始化完整文件存储
const completeFileStore = localforage.createInstance({
  name: "fileDownloadTest",
  storeName: "completeFiles",
  description: "用于存储合并后的完整文件",
});

// 下载状态枚举
const DownloadStatus = {
  IDLE: "idle",
  PREPARING: "preparing",
  DOWNLOADING: "downloading",
  PAUSED: "paused",
  COMPLETED: "completed",
  ERROR: "error",
} as const;

type DownloadStatusType = (typeof DownloadStatus)[keyof typeof DownloadStatus];

// 文件分片大小（5MB）
const CHUNK_SIZE = 5 * 1024 * 1024;

// 扩展文件信息接口，包含下载状态
interface DownloadFile {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType?: string;
  totalChunks: number;
  chunkSize?: number;
  downloadedChunks?: number;
  progress?: number;
  status: DownloadStatusType;
  completedAt?: number;
  error?: string;
}

/**
 * 文件下载测试组件 - 支持暂停和续传的简化版本
 */
const ZustandFileDownload: React.FC = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [files, setFiles] = useState<DownloadFile[]>([]);
  const [storedFiles, setStoredFiles] = useState<DownloadFile[]>([]);
  const [fetchingFiles, setFetchingFiles] = useState(false);
  const [storageUsage, setStorageUsage] = useState<{
    usage: number;
    quota: number;
    percent: number;
    isLoading: boolean;
    lastUpdated: number;
    estimatedUsage: number;
  }>({
    usage: 0,
    quota: 0,
    percent: 0,
    isLoading: false,
    lastUpdated: 0,
    estimatedUsage: 0,
  });
  const [abortControllers, setAbortControllers] = useState<
    Record<string, AbortController>
  >({});

  // 更新本地存储估算
  const updateLocalSizeEstimate = useCallback(
    async (fileId: string, sizeChange: number) => {
      // 更新存储使用情况的估计值
      setStorageUsage((prev) => {
        const newEstimatedUsage = prev.estimatedUsage + sizeChange;
        const newPercent =
          prev.quota > 0
            ? (newEstimatedUsage / prev.quota) * 100
            : prev.percent;

        return {
          ...prev,
          estimatedUsage: newEstimatedUsage,
          percent: newPercent,
        };
      });
    },
    []
  );

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
      messageApi.error("获取文件列表失败，请检查网络连接");
    } finally {
      setFetchingFiles(false);
    }
  }, [messageApi]);

  // 获取已存储的文件
  const getStoredFiles = useCallback(async () => {
    try {
      const keys = await fileStore.keys();
      const storedFilesData: DownloadFile[] = [];

      for (const key of keys) {
        const fileData = await fileStore.getItem<DownloadFile>(key);
        if (fileData) {
          // 检查文件下载状态，确保中断状态的文件能继续下载
          if (fileData.status === DownloadStatus.DOWNLOADING) {
            // 如果页面刷新前文件正在下载，改为暂停状态以便用户继续
            fileData.status = DownloadStatus.PAUSED;
            await fileStore.setItem(key, fileData);
          }
          storedFilesData.push(fileData);
        }
      }

      setStoredFiles(storedFilesData);
    } catch (error) {
      console.error("获取已存储文件失败:", error);
      messageApi.error("获取已存储文件失败");
    }
  }, [messageApi]);

  // 获取存储使用情况
  const getStorageUsage = useCallback(async () => {
    try {
      setStorageUsage((prev) => ({ ...prev, isLoading: true }));

      if ("storage" in navigator && "estimate" in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const percent = quota > 0 ? (usage / quota) * 100 : 0;

        setStorageUsage({
          usage,
          quota,
          percent,
          isLoading: false,
          lastUpdated: Date.now(),
          estimatedUsage: usage, // 重置估计值为实际值
        });
      }
    } catch (error) {
      console.error("获取存储使用情况失败:", error);
      setStorageUsage((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // 下载单个分片
  const downloadChunk = async (
    fileId: string,
    url: string,
    chunkIndex: number,
    fileSize: number,
    abortController: AbortController
  ) => {
    // 为什么我们要设置开始与结束？
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE - 1, fileSize - 1);

    try {
      const response = await fetch(url, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const chunkId = `${fileId}_chunk_${chunkIndex}`;

      // 存储分片到IndexedDB
      await chunkStore.setItem(chunkId, blob);

      // 更新本地存储估算
      await updateLocalSizeEstimate(fileId, blob.size);

      return {
        success: true,
        chunkIndex,
        size: blob.size,
      };
    } catch (err: unknown) {
      // 检查是否是因为中止导致的错误
      const error = err as Error;
      if (error.name === "AbortError") {
        console.log(`下载分片 ${chunkIndex} 已暂停`);
        return {
          success: false,
          chunkIndex,
          paused: true,
        };
      }

      console.error(`下载分片 ${chunkIndex} 失败:`, error);
      return {
        success: false,
        chunkIndex,
        error: error instanceof Error ? error.message : "未知错误",
      };
    }
  };

  // 合并文件分片
  const mergeFileChunks = async (file: DownloadFile): Promise<Blob> => {
    // 获取所有分片
    const totalChunks = file.totalChunks;
    const chunkKeys = Array.from(
      { length: totalChunks },
      (_, i) => `${file.id}_chunk_${i}`
    );
    const blobs: Blob[] = [];

    for (const key of chunkKeys) {
      const chunk = await chunkStore.getItem<Blob>(key);
      if (!chunk) {
        throw new Error(`分片 ${key} 不存在，无法合并文件`);
      }
      blobs.push(chunk);
    }

    // 合并所有分片
    return new Blob(blobs, {
      type: file.mimeType,
    });
  };

  // 下载剩余分片
  const downloadRemainingChunks = async (file: DownloadFile) => {
    try {
      // 确保totalChunks已定义
      const totalChunks = file.totalChunks;
      // 下载使用固定的CHUNK_SIZE

      // 检查已下载的分片
      const pendingChunks: number[] = [];

      // 检查哪些分片已经下载
      for (let i = 0; i < totalChunks; i++) {
        const chunkId = `${file.id}_chunk_${i}`;
        const chunk = await chunkStore.getItem(chunkId);
        if (!chunk) {
          pendingChunks.push(i);
        }
      }

      if (pendingChunks.length === 0) {
        // 所有分片已下载，直接完成
        await completeDownload(file);
        return;
      }

      messageApi.success(
        `继续下载 ${file.fileName}，剩余 ${pendingChunks.length} 个分片`
      );

      // 开始下载剩余分片
      let downloadedChunks = totalChunks - pendingChunks.length;
      const maxConcurrent = 3; // 最大并发数

      // 创建新的AbortController
      const controller = new AbortController();
      setAbortControllers((prev) => ({
        ...prev,
        [file.id]: controller,
      }));

      while (pendingChunks.length > 0) {
        // 检查是否已暂停或取消
        const currentFile = await fileStore.getItem<DownloadFile>(file.id);
        if (
          !currentFile ||
          currentFile.status === DownloadStatus.PAUSED ||
          currentFile.status === DownloadStatus.ERROR
        ) {
          console.log("下载已暂停或取消");
          return;
        }

        const currentBatch = pendingChunks.splice(0, maxConcurrent);
        const chunkPromises = currentBatch.map((chunkIndex) =>
          downloadChunk(
            file.id,
            apiClient.createDownloadUrl(file.id),
            chunkIndex,
            file.fileSize,
            controller
          )
        );

        const results = await Promise.all(chunkPromises);

        // 检查是否有暂停信号
        if (results.some((r) => r.paused)) {
          console.log("检测到暂停信号");
          return;
        }

        // 更新进度
        downloadedChunks += results.filter((r) => r.success).length;
        const progress = Math.round((downloadedChunks / totalChunks) * 100);

        const progressUpdate: DownloadFile = {
          ...file,
          downloadedChunks,
          progress,
          status:
            progress === 100
              ? DownloadStatus.COMPLETED
              : DownloadStatus.DOWNLOADING,
        };

        // 更新状态
        setFiles((prevFiles) =>
          prevFiles.map((f) => (f.id === file.id ? progressUpdate : f))
        );

        // 更新存储
        await fileStore.setItem(file.id, progressUpdate);
      }

      // 下载完成，处理文件
      await completeDownload(file);
    } catch (err: unknown) {
      const error = err as Error;
      console.error("下载剩余分片失败:", error);

      // 更新状态为错误
      const errorFile: DownloadFile = {
        ...file,
        status: DownloadStatus.ERROR,
        error: error instanceof Error ? error.message : String(error),
      };

      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === file.id ? errorFile : f))
      );

      await fileStore.setItem(file.id, errorFile);
      messageApi.error(`下载文件 ${file.fileName} 失败: ${errorFile.error}`);
    }
  };

  // 暂停下载
  const pauseDownload = async (fileId: string) => {
    try {
      // 获取当前文件信息
      const fileData = await fileStore.getItem<DownloadFile>(fileId);
      if (!fileData) {
        messageApi.error("找不到下载任务");
        return;
      }

      // 中止当前下载
      if (abortControllers[fileId]) {
        abortControllers[fileId].abort();
        const newAbortControllers = { ...abortControllers };
        delete newAbortControllers[fileId];
        setAbortControllers(newAbortControllers);
      }

      // 更新文件状态为暂停
      const pausedFile = {
        ...fileData,
        status: DownloadStatus.PAUSED,
      };

      // 更新状态
      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === fileId ? pausedFile : f))
      );

      // 更新存储
      await fileStore.setItem(fileId, pausedFile);
      messageApi.info(`已暂停下载 ${pausedFile.fileName}`);
    } catch (error) {
      console.error("暂停下载失败:", error);
      messageApi.error("暂停下载失败");
    }
  };

  // 继续下载
  const resumeDownload = async (fileId: string) => {
    try {
      // 获取当前文件信息
      const fileData = await fileStore.getItem<DownloadFile>(fileId);
      if (!fileData) {
        messageApi.error("找不到下载任务");
        return;
      }

      // 更新文件状态为下载中
      const updatedFile = {
        ...fileData,
        status: DownloadStatus.DOWNLOADING,
      };

      // 更新状态
      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === fileId ? updatedFile : f))
      );

      // 更新存储
      await fileStore.setItem(fileId, updatedFile);

      // 开始下载剩余分片
      await downloadRemainingChunks(updatedFile);
    } catch (error) {
      console.error("继续下载失败:", error);
      messageApi.error("继续下载失败");
    }
  };

  // 完成下载处理
  const completeDownload = async (file: DownloadFile) => {
    try {
      // 更新为已完成状态
      const completedFile: DownloadFile = {
        ...file,
        downloadedChunks: file.totalChunks,
        progress: 100,
        status: DownloadStatus.COMPLETED,
        completedAt: Date.now(),
      };

      // 直接更新文件状态，不改变其在列表中的位置
      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === file.id ? completedFile : f))
      );

      await fileStore.setItem(file.id, completedFile);

      // 合并文件
      try {
        messageApi.loading("正在处理文件...");

        // 记录合并前的总分片大小，用于后续估算
        let totalChunksSize = 0;
        const chunkIds = Array.from(
          { length: file.totalChunks },
          (_, i) => `${file.id}_chunk_${i}`
        );

        for (const chunkId of chunkIds) {
          const chunk = await chunkStore.getItem<Blob>(chunkId);
          if (chunk) {
            totalChunksSize += chunk.size;
          }
        }

        // 合并文件
        const mergedBlob = await mergeFileChunks(completedFile);

        // 存储合并后的完整文件
        await completeFileStore.setItem(file.id, mergedBlob);

        // 更新存储估算 (合并文件大小 - 分片总大小的差值，避免重复计算)
        // 如果保留分片，那么差值应该是正的；如果删除分片，则差值应该是负的
        const sizeDelta = mergedBlob.size - totalChunksSize;
        if (Math.abs(sizeDelta) > 100) {
          // 只有当差值显著时才更新
          await updateLocalSizeEstimate(file.id, sizeDelta);
        }

        messageApi.success(`文件 ${file.fileName} 下载完成并已合并保存`);
      } catch (error) {
        console.error("处理文件失败:", error);
        messageApi.warning(
          `文件已下载，但处理失败: ${
            error instanceof Error ? error.message : "未知错误"
          }`
        );
      }

      // 不立即调用navigator.storage.estimate()，使用估算值
      if (Date.now() - storageUsage.lastUpdated > 60000) {
        // 如果上次更新超过1分钟，才进行实际更新
        getStorageUsage();
      }
    } catch (error) {
      console.error("完成下载处理失败:", error);
      messageApi.error("完成下载处理失败");
    }
  };

  // 开始下载文件
  const startDownload = async (file: DownloadFile) => {
    try {
      // 更新文件状态为准备中
      const updatedFile = {
        ...file,
        status: DownloadStatus.PREPARING,
      };
      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === file.id ? updatedFile : f))
      );

      // 获取文件下载预处理信息
      messageApi.loading("正在准备下载...");

      // 计算分片数量
      const totalChunks = Math.ceil(file.fileSize / CHUNK_SIZE);

      // 更新文件信息
      const fileWithChunks: DownloadFile = {
        ...updatedFile,
        totalChunks,
        chunkSize: CHUNK_SIZE,
        status: DownloadStatus.DOWNLOADING,
        downloadedChunks: 0,
        progress: 0,
      };

      // 存储文件信息
      await fileStore.setItem(file.id, fileWithChunks);

      // 更新状态
      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === file.id ? fileWithChunks : f))
      );

      messageApi.success("开始下载文件");

      // 开始下载剩余分片（全部）
      await downloadRemainingChunks(fileWithChunks);
    } catch (error) {
      console.error("下载文件失败:", error);

      // 更新状态为错误
      const errorFile: DownloadFile = {
        ...file,
        totalChunks: file.totalChunks || Math.ceil(file.fileSize / CHUNK_SIZE),
        status: DownloadStatus.ERROR,
        error: error instanceof Error ? error.message : "下载失败",
      };

      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === file.id ? errorFile : f))
      );

      await fileStore.setItem(file.id, errorFile);
      messageApi.error(`下载文件 ${file.fileName} 失败: ${errorFile.error}`);
    }
  };

  // 删除文件
  const deleteFile = async (fileId: string) => {
    Modal.confirm({
      title: "确认删除",
      content:
        "确定要删除此文件吗？此操作将清除所有已下载的数据和下载进度，无法撤销。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          // 获取文件信息用于显示
          const fileToDelete =
            files.find((f) => f.id === fileId) ||
            storedFiles.find((f) => f.id === fileId);

          if (!fileToDelete) {
            messageApi.error("找不到要删除的文件");
            return;
          }

          // 中止正在进行的下载
          if (abortControllers[fileId]) {
            abortControllers[fileId].abort();
            const newAbortControllers = { ...abortControllers };
            delete newAbortControllers[fileId];
            setAbortControllers(newAbortControllers);
          }

          // 估算要删除的大小
          let totalSize = 0;

          // 获取并删除完整文件
          const completeFile = await completeFileStore.getItem<Blob>(fileId);
          if (completeFile) {
            totalSize += completeFile.size;
          }
          await completeFileStore.removeItem(fileId);

          // 获取所有分片的大小
          const chunkKeys = await chunkStore.keys();
          const fileChunkKeys = chunkKeys.filter((key) =>
            key.startsWith(`${fileId}_chunk_`)
          );

          for (const key of fileChunkKeys) {
            const chunk = await chunkStore.getItem<Blob>(key);
            if (chunk) {
              totalSize += chunk.size;
            }
            await chunkStore.removeItem(key);
          }

          // 删除文件信息
          await fileStore.removeItem(fileId);

          // 更新本地存储估算（负值表示减少）
          await updateLocalSizeEstimate(fileId, -totalSize);

          // 从本地存储列表中移除
          setStoredFiles((prev) => prev.filter((f) => f.id !== fileId));

          // 如果文件在服务器列表中，重置其状态而不是移除
          setFiles((prevFiles) =>
            prevFiles.map((f) => {
              if (f.id === fileId) {
                return {
                  ...f,
                  status: DownloadStatus.IDLE,
                  progress: 0,
                  downloadedChunks: 0,
                  error: undefined,
                  completedAt: undefined,
                };
              }
              return f;
            })
          );

          messageApi.success(
            `文件 ${fileToDelete.fileName} 已删除，下载状态已重置`
          );

          // 不立即调用navigator.storage.estimate()，使用估算值
          if (Date.now() - storageUsage.lastUpdated > 60000) {
            // 如果上次更新超过1分钟，才进行实际更新
            getStorageUsage();
          }
        } catch (error) {
          console.error("删除文件失败:", error);
          messageApi.error("删除文件失败");

          // 删除失败时，重新获取文件列表恢复状态
          await fetchFileList();
          await getStoredFiles();
          getStorageUsage(); // 更新实际存储使用情况
        }
      },
    });
  };

  // 导出文件
  const exportFile = async (file: DownloadFile) => {
    try {
      messageApi.loading("正在准备文件...");

      // 首先检查是否已有合并好的完整文件
      let mergedBlob = await completeFileStore.getItem<Blob>(file.id);

      // 如果没有合并好的文件，则从分片合并
      if (!mergedBlob) {
        messageApi.loading("正在合并文件分片...");
        mergedBlob = await mergeFileChunks(file);
      }

      // 创建下载链接
      const url = URL.createObjectURL(mergedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();

      // 清理
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      messageApi.success("文件已准备完成，开始下载");
    } catch (error) {
      console.error("合并文件失败:", error);
      messageApi.error(
        "合并文件失败: " + (error instanceof Error ? error.message : "未知错误")
      );
    }
  };

  // 取消下载任务
  const cancelDownload = async (fileId: string) => {
    Modal.confirm({
      title: "确认取消",
      content:
        "确定要取消下载此文件吗？已下载的数据将被清除，下载进度将会丢失。",
      okText: "取消下载",
      okType: "danger",
      cancelText: "继续下载",
      onOk: async () => {
        try {
          // 获取文件信息
          const fileData = await fileStore.getItem<DownloadFile>(fileId);
          const fileToCancel = files.find((f) => f.id === fileId) || fileData;

          if (!fileToCancel) {
            messageApi.error("找不到下载任务");
            return;
          }

          // 中止当前下载
          if (abortControllers[fileId]) {
            abortControllers[fileId].abort();
            const newAbortControllers = { ...abortControllers };
            delete newAbortControllers[fileId];
            setAbortControllers(newAbortControllers);
          }

          // 估算要删除的大小
          let totalSize = 0;

          // 获取分片大小
          const chunkKeys = await chunkStore.keys();
          const fileChunkKeys = chunkKeys.filter((key) =>
            key.startsWith(`${fileId}_chunk_`)
          );

          for (const key of fileChunkKeys) {
            const chunk = await chunkStore.getItem<Blob>(key);
            if (chunk) {
              totalSize += chunk.size;
            }
            await chunkStore.removeItem(key);
          }

          // 删除文件信息
          await fileStore.removeItem(fileId);

          // 更新本地存储估算
          if (totalSize > 0) {
            await updateLocalSizeEstimate(fileId, -totalSize);
          }

          // 更新服务器文件列表中的状态
          setFiles((prevFiles) =>
            prevFiles.map((f) => {
              if (f.id === fileId) {
                return {
                  ...f,
                  status: DownloadStatus.IDLE,
                  progress: 0,
                  downloadedChunks: 0,
                  error: undefined,
                  completedAt: undefined,
                };
              }
              return f;
            })
          );

          // 从本地存储文件列表中移除
          setStoredFiles((prev) => prev.filter((f) => f.id !== fileId));

          messageApi.success(`已取消下载 ${fileToCancel.fileName}`);

          // 不立即调用navigator.storage.estimate()，使用估算值
          if (Date.now() - storageUsage.lastUpdated > 60000) {
            // 如果上次更新超过1分钟，才进行实际更新
            getStorageUsage();
          }
        } catch (error) {
          console.error("取消下载失败:", error);
          messageApi.error("取消下载失败");

          // 取消失败时，重新获取文件列表恢复状态
          await fetchFileList();
          await getStoredFiles();
          getStorageUsage(); // 更新实际存储使用情况
        }
      },
    });
  };

  // 清空所有数据
  const clearAllData = async () => {
    try {
      setStorageUsage((prev) => ({ ...prev, isLoading: true }));

      await fileStore.clear();
      await chunkStore.clear();
      await completeFileStore.clear();

      // 清空本地存储的文件记录
      setStoredFiles([]);

      // 重置服务器文件列表中的文件状态为初始状态
      setFiles((prevFiles) =>
        prevFiles.map((file) => ({
          ...file,
          status: DownloadStatus.IDLE,
          progress: 0,
          downloadedChunks: 0,
          error: undefined,
          completedAt: undefined,
        }))
      );

      // 中止所有正在进行的下载
      Object.values(abortControllers).forEach((controller) => {
        controller.abort();
      });
      setAbortControllers({});

      // 重置估算值
      setStorageUsage((prev) => ({
        ...prev,
        estimatedUsage: 0,
        percent: 0,
      }));

      messageApi.success("所有数据已清除，文件状态已重置");

      // 强制更新存储使用情况
      getStorageUsage();
    } catch (error) {
      console.error("清除数据失败:", error);
      messageApi.error("清除数据失败");
      setStorageUsage((prev) => ({ ...prev, isLoading: false }));
    }
  };

  // 初始化
  useEffect(() => {
    const initializeData = async () => {
      await fetchFileList();
      await getStoredFiles();
      getStorageUsage();
    };

    initializeData();
  }, [fetchFileList, getStoredFiles, getStorageUsage]);

  return (
    <div style={{ padding: "20px" }}>
      {contextHolder}
      <Title level={2}>大文件下载测试</Title>
      <Paragraph>
        此组件用于测试大文件下载，支持暂停和断点续传功能。
        每个文件以5MB分片下载，确保稳定可靠的断点续传体验。
      </Paragraph>

      <Card
        title={
          <Space>
            <span>存储使用情况</span>
            {storageUsage.isLoading && <Spin size="small" />}
          </Space>
        }
        style={{ marginBottom: "20px" }}
        extra={
          <Space>
            {storageUsage.lastUpdated > 0 && (
              <Text type="secondary">
                更新于:{" "}
                {new Date(storageUsage.lastUpdated).toLocaleTimeString()}
              </Text>
            )}
            <Button
              size="small"
              onClick={getStorageUsage}
              icon={<ReloadOutlined />}
              loading={storageUsage.isLoading}
            >
              刷新
            </Button>
          </Space>
        }
      >
        <Paragraph>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Text>
              已使用:{" "}
              {formatFileSize(
                storageUsage.estimatedUsage || storageUsage.usage
              )}{" "}
              / {formatFileSize(storageUsage.quota)}（
              {(storageUsage.estimatedUsage
                ? (storageUsage.estimatedUsage / storageUsage.quota) * 100
                : storageUsage.percent
              ).toFixed(2)}
              %）
              {storageUsage.estimatedUsage !== storageUsage.usage && (
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  (实际值: {formatFileSize(storageUsage.usage)})
                </Text>
              )}
            </Text>
            <Progress
              percent={parseFloat(
                (storageUsage.estimatedUsage
                  ? (storageUsage.estimatedUsage / storageUsage.quota) * 100
                  : storageUsage.percent
                ).toFixed(1)
              )}
              status={storageUsage.isLoading ? "active" : "normal"}
            />
          </Space>
        </Paragraph>
        <Button
          danger
          onClick={clearAllData}
          icon={<DeleteOutlined />}
          disabled={storageUsage.isLoading}
        >
          清空所有数据
        </Button>
      </Card>

      <Card
        title="文件列表"
        extra={
          <Button
            loading={fetchingFiles}
            onClick={fetchFileList}
            icon={<ReloadOutlined />}
          >
            刷新
          </Button>
        }
        style={{ marginBottom: "20px" }}
      >
        <List
          dataSource={[
            // 优先显示服务器上的文件，保持原始顺序
            ...files,
            // 最后显示本地存储但不在服务器列表中的文件
            ...storedFiles.filter((sf) => !files.some((f) => f.id === sf.id)),
          ]}
          renderItem={(file) => {
            // 使用变量存储状态，避免类型错误
            const isDownloading = file.status === "downloading";
            const isPaused = file.status === "paused";
            const isCompleted = file.status === "completed";
            const isPreparing = file.status === "preparing";
            const isIdle = file.status === "idle";
            const isError = file.status === "error";

            return (
              <List.Item
                key={file.id}
                actions={[
                  isDownloading ? (
                    <Button
                      icon={<PauseCircleOutlined />}
                      onClick={() => pauseDownload(file.id)}
                    >
                      暂停
                    </Button>
                  ) : isPaused ? (
                    <Button
                      icon={<PlayCircleOutlined />}
                      onClick={() => resumeDownload(file.id)}
                    >
                      继续
                    </Button>
                  ) : isCompleted ? (
                    <Button
                      type="primary"
                      onClick={() => exportFile(file)}
                      icon={<DownloadOutlined />}
                    >
                      导出
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      icon={<DownloadOutlined />}
                      loading={isPreparing}
                      disabled={isDownloading || isCompleted}
                      onClick={() => startDownload(file)}
                    >
                      {isPreparing ? "准备中" : "下载"}
                    </Button>
                  ),
                  !isIdle && !isCompleted ? (
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => cancelDownload(file.id)}
                    >
                      取消
                    </Button>
                  ) : isCompleted ? (
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => deleteFile(file.id)}
                    >
                      删除
                    </Button>
                  ) : null,
                ].filter(Boolean)}
              >
                <List.Item.Meta
                  avatar={<FileOutlined />}
                  title={<Text>{file.fileName}</Text>}
                  description={
                    <>
                      <Text type="secondary">
                        大小: {formatFileSize(file.fileSize)} | 类型:{" "}
                        {file.mimeType} | 分片大小: 5MB | 分片数:{" "}
                        {file.totalChunks}
                      </Text>
                      {!isIdle && (
                        <div style={{ marginTop: "8px" }}>
                          <Progress
                            percent={file.progress}
                            size="small"
                            status={
                              isError
                                ? "exception"
                                : isCompleted
                                ? "success"
                                : "active"
                            }
                          />
                          <div>
                            <Tag
                              color={
                                isDownloading
                                  ? "processing"
                                  : isPreparing
                                  ? "warning"
                                  : isPaused
                                  ? "default"
                                  : isCompleted
                                  ? "success"
                                  : isError
                                  ? "error"
                                  : "default"
                              }
                            >
                              {isDownloading
                                ? "下载中"
                                : isPreparing
                                ? "准备中"
                                : isPaused
                                ? "已暂停"
                                : isCompleted
                                ? "已完成"
                                : isError
                                ? "错误"
                                : "等待中"}
                            </Tag>
                            {isError && (
                              <Text type="danger" style={{ marginLeft: "8px" }}>
                                {file.error}
                              </Text>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  }
                />
              </List.Item>
            );
          }}
          locale={{ emptyText: "暂无文件" }}
        />
      </Card>
    </div>
  );
};

export default ZustandFileDownload;
