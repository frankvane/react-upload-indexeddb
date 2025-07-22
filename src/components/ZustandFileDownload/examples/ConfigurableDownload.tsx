import React from "react";
import ZustandFileDownload from "../index";
import { DownloadFile, StorageStats } from "../types/download";

/**
 * 可配置的下载组件示例
 * 展示如何使用各种配置选项和回调事件
 */
const ConfigurableDownloadExample: React.FC = () => {
  // 下载开始回调
  const handleDownloadStart = (file: DownloadFile) => {
    console.log("下载开始:", file.fileName);
  };

  // 下载进度回调
  const handleDownloadProgress = (file: DownloadFile, progress: number) => {
    console.log(`下载进度 ${file.fileName}: ${progress}%`);
  };

  // 下载完成回调
  const handleDownloadComplete = (file: DownloadFile, success: boolean) => {
    if (success) {
      console.log("下载成功:", file.fileName);
    } else {
      console.log("下载失败:", file.fileName);
    }
  };

  // 下载错误回调
  const handleDownloadError = (file: DownloadFile, error: string) => {
    console.error(`下载错误 ${file.fileName}:`, error);
  };

  // 批次完成回调
  const handleBatchComplete = (results: { success: number; failed: number; total: number }) => {
    console.log("批次下载完成:", results);
  };

  // 存储变化回调
  const handleStorageChange = (stats: StorageStats) => {
    console.log("存储使用情况:", stats);
  };

  return (
    <div>
      <h1>可配置的下载组件示例</h1>
      
      <ZustandFileDownload
        // API 配置
        baseURL="https://api.example.com"
        listApi="/api/files/list"
        downloadApi="/api/files/download"
        
        // 下载参数配置
        chunkSize={2 * 1024 * 1024} // 2MB 分片
        maxConcurrency={5} // 最大并发数
        maxRetries={5} // 最大重试次数
        retryDelay={2000} // 重试延迟 2 秒
        
        // UI 配置
        autoStart={true} // 自动开始下载
        showProgress={true} // 显示进度
        showStorageStats={true} // 显示存储统计
        showNetworkStatus={true} // 显示网络状态
        
        // 回调事件
        onDownloadStart={handleDownloadStart}
        onDownloadProgress={handleDownloadProgress}
        onDownloadComplete={handleDownloadComplete}
        onDownloadError={handleDownloadError}
        onBatchComplete={handleBatchComplete}
        onStorageChange={handleStorageChange}
      />
    </div>
  );
};

export default ConfigurableDownloadExample;
