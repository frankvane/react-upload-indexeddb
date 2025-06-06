import { FileList, StorageStats } from "./components";
import React, { useEffect } from "react";
import {
  useDownloadFiles,
  useFileDownloader,
  useStorageManager,
} from "./hooks";

import { Space } from "antd";
import { initializeStorage } from "./utils/storage";

/**
 * ZustandFileDownload组件
 * 使用Zustand进行状态管理的大文件下载组件
 */
const ZustandFileDownload: React.FC = () => {
  // 使用自定义hooks
  const { files, fetchingFiles } = useDownloadFiles();
  const { storageUsage, getStorageUsage, clearAllData } = useStorageManager();
  const {
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteFile,
    exportFile,
    processingFiles,
    resetProcessingState,
  } = useFileDownloader();

  // 初始化存储
  useEffect(() => {
    const initStorage = async () => {
      try {
        console.log("初始化存储...");
        await initializeStorage();
        console.log("存储初始化成功");

        // 初始化后获取存储使用情况
        await getStorageUsage();
      } catch (error) {
        console.error("初始化存储失败:", error);
      }
    };

    initStorage();
  }, [getStorageUsage]);

  // 在文件列表变化时更新存储使用情况
  useEffect(() => {
    // 如果文件列表发生变化，可能需要更新存储使用情况
    if (files.length > 0) {
      console.log("文件列表更新，准备更新存储使用情况");

      // 使用setTimeout延迟更新，避免频繁触发
      const timer = setTimeout(() => {
        getStorageUsage();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [files.length, getStorageUsage]);

  // 记录文件状态变化
  useEffect(() => {
    console.log("文件列表更新:", files.length);

    // 记录暂停文件的进度
    const pausedFiles = files.filter((file) => file.status === "paused");
    if (pausedFiles.length > 0) {
      console.log("暂停的文件:");
      pausedFiles.forEach((file) => {
        console.log(
          `- ${file.fileName}: 进度 ${file.progress}%, 已下载分片 ${file.downloadedChunks}/${file.totalChunks}`
        );
      });
    }
  }, [files]);

  return (
    <div style={{ padding: "20px" }}>
      <h2>大文件下载测试</h2>
      <p>此组件用于测试大文件下载，支持暂停和断点续传功能。</p>

      <Space direction="vertical" style={{ width: "100%" }}>
        {/* 存储统计组件 */}
        <StorageStats
          storageUsage={storageUsage}
          getStorageUsage={getStorageUsage}
          clearAllData={clearAllData}
        />

        {/* 文件列表组件 */}
        <FileList
          files={files}
          fetchingFiles={fetchingFiles}
          processingFiles={processingFiles}
          onStartDownload={startDownload}
          onPauseDownload={pauseDownload}
          onResumeDownload={resumeDownload}
          onCancelDownload={cancelDownload}
          onDeleteFile={deleteFile}
          onExportFile={exportFile}
          onResetProcessingState={resetProcessingState}
        />
      </Space>
    </div>
  );
};

export default ZustandFileDownload;
