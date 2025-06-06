import * as apiClient from "./api.client.js";

import {
  Button,
  Card,
  Divider,
  List,
  Modal,
  Progress,
  Radio,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  FileOutlined,
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

// 存储模式
enum StorageMode {
  CHUNKS_ONLY = "CHUNKS_ONLY", // 只存储分片，需要时合并
  COMPLETE_ONLY = "COMPLETE_ONLY", // 只存储完整文件，不保留分片
  BOTH = "BOTH", // 同时存储分片和完整文件
}

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

// 扩展文件信息接口，包含下载状态
interface DownloadFile {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType?: string;
  url: string;
  chunks?: number;
  totalChunks?: number;
  chunkSize?: number;
  downloadedChunks?: number;
  progress: number;
  status: DownloadStatusType;
  error?: string;
  createdAt: number;
  completedAt?: number;
  metadata?: Record<string, any>;
}

/**
 * 文件下载测试组件
 *
 * 用于测试大文件通过IndexedDB和localforage存储的可行性
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
  const [storageMode, setStorageMode] = useState<StorageMode>(
    StorageMode.COMPLETE_ONLY
  );

  // 获取文件列表
  const fetchFileList = useCallback(async () => {
    try {
      setFetchingFiles(true);
      const downloadFiles = await apiClient.getDownloadFiles();

      setFiles(
        downloadFiles.map((file: any) => ({
          ...file,
          chunks: Math.ceil(file.fileSize / (5 * 1024 * 1024)), // 默认5MB一个分片
          downloadedChunks: 0,
          progress: 0,
          status: DownloadStatus.IDLE as DownloadStatusType,
          createdAt: Date.now(),
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
    chunkSize: number,
    fileSize: number
  ) => {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize - 1, fileSize - 1);

    try {
      const response = await fetch(url, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
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
    } catch (error) {
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
    const totalChunks = file.totalChunks || 1;
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
      type: file.fileType || file.mimeType,
    });
  };

  // 开始下载文件
  const startDownload = async (file: DownloadFile) => {
    try {
      // 更新文件状态为准备中
      const updatedFile = {
        ...file,
        status: DownloadStatus.PREPARING as DownloadStatusType,
      };
      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === file.id ? updatedFile : f))
      );

      // 获取文件下载预处理信息
      messageApi.loading("正在准备下载...");
      const preparedData = await apiClient.prepareDownload(file.id);

      // 更新文件信息
      const fileWithChunks: DownloadFile = {
        ...updatedFile,
        fileType: preparedData.fileType,
        totalChunks: preparedData.totalChunks,
        chunkSize: preparedData.chunkSize,
        status: DownloadStatus.DOWNLOADING as DownloadStatusType,
      };

      // 存储文件信息
      await fileStore.setItem(file.id, fileWithChunks);

      // 更新状态
      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === file.id ? fileWithChunks : f))
      );

      messageApi.success("开始下载文件");

      // 开始下载分片
      let downloadedChunks = 0;
      const maxConcurrent = 3; // 最大并发数
      const pendingChunks = Array.from(
        { length: preparedData.totalChunks },
        (_, i) => i
      );

      while (pendingChunks.length > 0) {
        const currentBatch = pendingChunks.splice(0, maxConcurrent);
        const chunkPromises = currentBatch.map((chunkIndex) =>
          downloadChunk(
            file.id,
            apiClient.createDownloadUrl(file.id),
            chunkIndex,
            preparedData.chunkSize,
            file.fileSize
          )
        );

        const results = await Promise.all(chunkPromises);

        // 更新进度
        downloadedChunks += results.filter((r) => r.success).length;
        const progress = Math.round(
          (downloadedChunks / preparedData.totalChunks) * 100
        );

        const progressUpdate: DownloadFile = {
          ...fileWithChunks,
          downloadedChunks,
          progress,
          status:
            progress === 100
              ? (DownloadStatus.COMPLETED as DownloadStatusType)
              : (DownloadStatus.DOWNLOADING as DownloadStatusType),
        };

        // 更新状态
        setFiles((prevFiles) =>
          prevFiles.map((f) => (f.id === file.id ? progressUpdate : f))
        );

        // 更新存储
        await fileStore.setItem(file.id, progressUpdate);
      }

      // 所有分片下载完成，更新状态
      const completedFile: DownloadFile = {
        ...fileWithChunks,
        downloadedChunks: preparedData.totalChunks,
        progress: 100,
        status: DownloadStatus.COMPLETED as DownloadStatusType,
        completedAt: Date.now(),
      };

      setFiles((prevFiles) =>
        prevFiles.map((f) => (f.id === file.id ? completedFile : f))
      );

      await fileStore.setItem(file.id, completedFile);

      // 下载完成后根据存储模式处理文件
      try {
        messageApi.loading("正在处理文件...");

        if (storageMode === StorageMode.CHUNKS_ONLY) {
          // 只保留分片，不存储合并文件
          messageApi.success(`文件 ${file.fileName} 下载完成，以分片形式存储`);
        } else {
          // 需要合并文件
          const mergedBlob = await mergeFileChunks(completedFile);

          // 存储合并后的完整文件
          await completeFileStore.setItem(file.id, mergedBlob);

          // 如果只保留完整文件，则删除分片
          if (storageMode === StorageMode.COMPLETE_ONLY) {
            // 删除所有分片
            const chunkKeys = await chunkStore.keys();
            const fileChunkKeys = chunkKeys.filter((key) =>
              key.startsWith(`${file.id}_chunk_`)
            );

            for (const key of fileChunkKeys) {
              await chunkStore.removeItem(key);
            }

            messageApi.success(
              `文件 ${file.fileName} 下载完成并已合并保存，分片已删除`
            );
          } else {
            // 同时保留分片和完整文件
            messageApi.success(`文件 ${file.fileName} 下载完成并已合并保存`);
          }
        }
      } catch (error) {
        console.error("处理文件失败:", error);
        messageApi.warning(
          `文件已下载，但处理失败: ${
            error instanceof Error ? error.message : "未知错误"
          }`
        );
      }

      // 刷新已存储文件列表
      getStoredFiles();
      getStorageUsage();
    } catch (error) {
      console.error("下载文件失败:", error);

      // 更新状态为错误
      const errorFile: DownloadFile = {
        ...file,
        status: DownloadStatus.ERROR as DownloadStatusType,
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

  // 合并并下载文件
  const mergeAndDownload = async (file: DownloadFile) => {
    try {
      messageApi.loading("正在准备文件...");

      // 首先检查是否已有合并好的完整文件
      let mergedBlob = await completeFileStore.getItem<Blob>(file.id);

      // 如果没有合并好的文件，则从分片合并
      if (!mergedBlob) {
        messageApi.loading("正在合并文件分片...");
        mergedBlob = await mergeFileChunks(file);

        // 如果设置为保存完整文件，则存储合并后的文件
        if (storageMode !== StorageMode.CHUNKS_ONLY) {
          await completeFileStore.setItem(file.id, mergedBlob);
        }
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

      // 显示确认对话框询问是否删除缓存
      Modal.confirm({
        title: "是否删除缓存数据",
        content: `文件 ${file.fileName} 已成功导出，是否删除缓存数据以释放存储空间？`,
        okText: "删除",
        cancelText: "保留",
        onOk: async () => {
          await deleteFile(file.id);
          messageApi.success("缓存数据已删除");
        },
      });
    } catch (error) {
      console.error("合并文件失败:", error);
      messageApi.error(
        "合并文件失败: " + (error instanceof Error ? error.message : "未知错误")
      );
    }
  };

  // 清空所有数据
  const clearAllData = async () => {
    try {
      await fileStore.clear();
      await chunkStore.clear();
      await completeFileStore.clear();
      setStoredFiles([]);
      messageApi.success("所有数据已清除");
      getStorageUsage();
    } catch (error) {
      console.error("清除数据失败:", error);
      messageApi.error("清除数据失败");
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
        此组件用于测试IndexedDB和localforage存储大文件的可行性。通过分片下载和存储，可以有效处理大文件，并支持断点续传。
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
          <Button danger onClick={clearAllData} icon={<DeleteOutlined />}>
            清空所有数据
          </Button>
        </Space>
      </Card>

      <Card title="存储模式设置" style={{ marginBottom: "20px" }}>
        <Radio.Group
          value={storageMode}
          onChange={(e) => setStorageMode(e.target.value)}
          buttonStyle="solid"
        >
          <Radio.Button value={StorageMode.COMPLETE_ONLY}>
            <Tooltip title="只存储合并后的完整文件，节省空间但不支持断点续传">
              只存完整文件
            </Tooltip>
          </Radio.Button>
          <Radio.Button value={StorageMode.CHUNKS_ONLY}>
            <Tooltip title="只存储文件分片，支持断点续传但导出时需要重新合并">
              只存分片
            </Tooltip>
          </Radio.Button>
          <Radio.Button value={StorageMode.BOTH}>
            <Tooltip title="同时存储分片和完整文件，支持断点续传和快速导出，但占用空间最大">
              两者都存
            </Tooltip>
          </Radio.Button>
        </Radio.Group>
        <Paragraph style={{ marginTop: "10px" }}>
          <Text type="secondary">
            当前模式：
            {storageMode === StorageMode.COMPLETE_ONLY &&
              "只存储完整文件（占用空间最少，不支持断点续传）"}
            {storageMode === StorageMode.CHUNKS_ONLY &&
              "只存储文件分片（支持断点续传，导出时需要合并）"}
            {storageMode === StorageMode.BOTH &&
              "同时存储分片和完整文件（功能完整，但占用空间最大）"}
          </Text>
        </Paragraph>
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
          renderItem={(file) => (
            <List.Item
              key={file.id}
              actions={[
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  loading={
                    file.status === DownloadStatus.DOWNLOADING ||
                    file.status === DownloadStatus.PREPARING
                  }
                  disabled={
                    file.status === DownloadStatus.DOWNLOADING ||
                    file.status === DownloadStatus.COMPLETED
                  }
                  onClick={() => startDownload(file)}
                >
                  {file.status === DownloadStatus.COMPLETED
                    ? "已完成"
                    : file.status === DownloadStatus.DOWNLOADING
                    ? "下载中"
                    : file.status === DownloadStatus.PREPARING
                    ? "准备中"
                    : "下载"}
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={<FileOutlined />}
                title={<Text>{file.fileName}</Text>}
                description={
                  <>
                    <Text type="secondary">
                      大小: {formatFileSize(file.fileSize)} | 类型:{" "}
                      {file.mimeType} | 分片数: {file.chunks}
                    </Text>
                    {file.status !== DownloadStatus.IDLE && (
                      <div style={{ marginTop: "8px" }}>
                        <Progress percent={file.progress} size="small" />
                        <div>
                          <Tag
                            color={
                              file.status === DownloadStatus.DOWNLOADING
                                ? "processing"
                                : file.status === DownloadStatus.PREPARING
                                ? "warning"
                                : file.status === DownloadStatus.COMPLETED
                                ? "success"
                                : file.status === DownloadStatus.ERROR
                                ? "error"
                                : "default"
                            }
                          >
                            {file.status === DownloadStatus.DOWNLOADING
                              ? "下载中"
                              : file.status === DownloadStatus.PREPARING
                              ? "准备中"
                              : file.status === DownloadStatus.COMPLETED
                              ? "已完成"
                              : file.status === DownloadStatus.ERROR
                              ? "错误"
                              : "等待中"}
                          </Tag>
                          {file.status === DownloadStatus.ERROR && (
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
          )}
          locale={{ emptyText: "暂无可下载文件" }}
        />
      </Card>

      <Card title="已存储文件列表">
        <List
          dataSource={storedFiles}
          renderItem={(file) => (
            <List.Item
              key={file.id}
              actions={[
                <Button
                  type="primary"
                  onClick={() => mergeAndDownload(file)}
                  disabled={file.status !== DownloadStatus.COMPLETED}
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
                      {file.status === DownloadStatus.DOWNLOADING
                        ? "下载中"
                        : file.status === DownloadStatus.PREPARING
                        ? "准备中"
                        : file.status === DownloadStatus.COMPLETED
                        ? "已完成"
                        : file.status === DownloadStatus.ERROR
                        ? "错误"
                        : "等待中"}
                    </Text>
                    <Progress
                      percent={file.progress}
                      size="small"
                      status={
                        file.status === DownloadStatus.ERROR
                          ? "exception"
                          : file.status === DownloadStatus.COMPLETED
                          ? "success"
                          : "active"
                      }
                    />
                  </>
                }
              />
            </List.Item>
          )}
          locale={{ emptyText: "暂无已存储文件" }}
        />
      </Card>

      <Divider />
      <Paragraph>
        <Text strong>技术说明：</Text>{" "}
        此组件使用localforage库操作IndexedDB，通过分片下载大文件并存储到IndexedDB中。
        根据选择的存储模式，文件可以以分片形式存储、完整文件形式存储或两者兼有。
        默认模式为"只存完整文件"，可以节省约50%的存储空间。
        文件保存在浏览器的IndexedDB数据库中，可以通过"导出"按钮将文件下载到本地。
      </Paragraph>
    </div>
  );
};

export default ZustandFileDownload;
