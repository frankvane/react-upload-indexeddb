import * as apiClient from "./api.client.js";

import {
  Button,
  Card,
  List,
  Progress,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
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
  }>({ usage: 0, quota: 0, percent: 0 });
  const [abortControllers, setAbortControllers] = useState<
    Record<string, AbortController>
  >({});

  // 获取文件列表
  const fetchFileList = useCallback(async () => {
    try {
      setFetchingFiles(true);
      const downloadFiles = await apiClient.getDownloadFiles();

      setFiles(
        downloadFiles.map((file: any) => ({
          ...file,
          totalChunks: Math.ceil(file.fileSize / CHUNK_SIZE),
          downloadedChunks: 0,
          progress: 0,
          status: DownloadStatus.IDLE,
        }))
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
      if ("storage" in navigator && "estimate" in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const percent = quota > 0 ? (usage / quota) * 100 : 0;

        setStorageUsage({
          usage,
          quota,
          percent,
        });
      }
    } catch (error) {
      console.error("获取存储使用情况失败:", error);
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

      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === file.id ? completedFile : f))
      );

      await fileStore.setItem(file.id, completedFile);

      // 合并文件
      try {
        messageApi.loading("正在处理文件...");

        // 合并文件
        const mergedBlob = await mergeFileChunks(completedFile);

        // 存储合并后的完整文件
        await completeFileStore.setItem(file.id, mergedBlob);

        messageApi.success(`文件 ${file.fileName} 下载完成并已合并保存`);
      } catch (error) {
        console.error("处理文件失败:", error);
        messageApi.warning(
          `文件已下载，但处理失败: ${
            error instanceof Error ? error.message : "未知错误"
          }`
        );
      }

      // 刷新已存储文件列表和存储使用情况
      getStoredFiles();
      getStorageUsage();
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
    try {
      // 删除文件信息
      await fileStore.removeItem(fileId);

      // 删除合并后的完整文件
      await completeFileStore.removeItem(fileId);

      // 删除所有相关分片
      const chunkKeys = await chunkStore.keys();
      const fileChunkKeys = chunkKeys.filter((key) =>
        key.startsWith(`${fileId}_chunk_`)
      );

      for (const key of fileChunkKeys) {
        await chunkStore.removeItem(key);
      }

      // 更新列表
      setStoredFiles((prev) => prev.filter((f) => f.id !== fileId));
      messageApi.success("文件已删除");

      // 刷新存储使用情况
      getStorageUsage();
    } catch (error) {
      console.error("删除文件失败:", error);
      messageApi.error("删除文件失败");
    }
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
    try {
      // 中止当前下载
      if (abortControllers[fileId]) {
        abortControllers[fileId].abort();
        const newAbortControllers = { ...abortControllers };
        delete newAbortControllers[fileId];
        setAbortControllers(newAbortControllers);
      }

      // 获取文件信息
      const fileData = await fileStore.getItem<DownloadFile>(fileId);
      if (!fileData) {
        messageApi.error("找不到下载任务");
        return;
      }

      // 删除文件信息和分片
      await deleteFile(fileId);

      // 更新文件列表
      setFiles((prevFiles) => prevFiles.filter((f) => f.id !== fileId));

      messageApi.success(`已取消下载 ${fileData.fileName}`);
    } catch (error) {
      console.error("取消下载失败:", error);
      messageApi.error("取消下载失败");
    }
  };

  // 初始化
  useEffect(() => {
    fetchFileList();
    getStoredFiles();
    getStorageUsage();
  }, [fetchFileList, getStoredFiles, getStorageUsage]);

  return (
    <div style={{ padding: "20px" }}>
      {contextHolder}
      <Title level={2}>大文件下载测试</Title>
      <Paragraph>
        此组件用于测试大文件下载，支持暂停和断点续传功能。
        每个文件以5MB分片下载，确保稳定可靠的断点续传体验。
      </Paragraph>

      <Card title="存储使用情况" style={{ marginBottom: "20px" }}>
        <Paragraph>
          已使用: {formatFileSize(storageUsage.usage)} /{" "}
          {formatFileSize(storageUsage.quota)}（
          {storageUsage.percent.toFixed(2)}%）
        </Paragraph>
        <Progress percent={parseFloat(storageUsage.percent.toFixed(1))} />
        <Space style={{ marginTop: "10px" }}>
          <Button onClick={getStorageUsage} icon={<ReloadOutlined />}>
            刷新
          </Button>
        </Space>
      </Card>

      <Card
        title="可下载文件列表"
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
          dataSource={files}
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
                      icon={<CheckCircleOutlined />}
                      disabled
                    >
                      已完成
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
                          <Progress percent={file.progress} size="small" />
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
          locale={{ emptyText: "暂无可下载文件" }}
        />
      </Card>

      <Card title="已下载文件列表">
        <List
          dataSource={storedFiles}
          renderItem={(file) => (
            <List.Item
              key={file.id}
              actions={[
                <Button
                  type="primary"
                  onClick={() => exportFile(file)}
                  disabled={file.status !== "completed"}
                >
                  导出
                </Button>,
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => deleteFile(file.id)}
                >
                  删除
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={<FileOutlined />}
                title={<Text>{file.fileName}</Text>}
                description={
                  <>
                    <Text type="secondary">
                      大小: {formatFileSize(file.fileSize)} | 进度:{" "}
                      {file.progress}% | 状态:{" "}
                      {file.status === "downloading"
                        ? "下载中"
                        : file.status === "preparing"
                        ? "准备中"
                        : file.status === "completed"
                        ? "已完成"
                        : file.status === "error"
                        ? "错误"
                        : "等待中"}
                    </Text>
                    <Progress
                      percent={file.progress}
                      size="small"
                      status={
                        file.status === "error"
                          ? "exception"
                          : file.status === "completed"
                          ? "success"
                          : "active"
                      }
                    />
                  </>
                }
              />
            </List.Item>
          )}
          locale={{ emptyText: "暂无已下载文件" }}
        />
      </Card>
    </div>
  );
};

export default ZustandFileDownload;
