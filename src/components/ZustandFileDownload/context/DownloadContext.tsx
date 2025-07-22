import React, { createContext, useContext } from "react";
import {
  ZustandFileDownloadProps,
  DownloadFile,
  StorageStats,
  DownloadConfig,
} from "../types/download";

interface DownloadContextType {
  // API 配置
  baseURL: string;
  listApi: string;
  downloadApi: string;

  // 下载参数配置
  chunkSize: number;
  maxConcurrency: number;
  maxRetries: number;
  retryDelay: number;

  // UI 配置
  autoStart: boolean;
  showProgress: boolean;
  showStorageStats: boolean;
  showNetworkStatus: boolean;

  // 回调事件
  onDownloadStart?: (file: DownloadFile) => void;
  onDownloadProgress?: (file: DownloadFile, progress: number) => void;
  onDownloadComplete?: (file: DownloadFile, success: boolean) => void;
  onDownloadError?: (file: DownloadFile, error: string) => void;
  onBatchComplete?: (results: {
    success: number;
    failed: number;
    total: number;
  }) => void;
  onStorageChange?: (stats: StorageStats) => void;

  // 自定义方法
  customDownloadHandler?: (
    file: DownloadFile,
    config: DownloadConfig
  ) => Promise<boolean>;
  customProgressHandler?: (file: DownloadFile, progress: number) => void;
}

const DownloadContext = createContext<DownloadContextType | undefined>(
  undefined
);

interface DownloadProviderProps extends ZustandFileDownloadProps {
  children: React.ReactNode;
}

export const DownloadProvider: React.FC<DownloadProviderProps> = ({
  children,
  baseURL = "",
  listApi = "/api/files",
  downloadApi = "/api/download",
  chunkSize = 5 * 1024 * 1024, // 5MB
  maxConcurrency = 3,
  maxRetries = 3,
  retryDelay = 1000,
  autoStart = false,
  showProgress = true,
  showStorageStats = true,
  showNetworkStatus = true,
  onDownloadStart,
  onDownloadProgress,
  onDownloadComplete,
  onDownloadError,
  onBatchComplete,
  onStorageChange,
  customDownloadHandler,
  customProgressHandler,
}) => {
  const value: DownloadContextType = {
    baseURL,
    listApi,
    downloadApi,
    chunkSize,
    maxConcurrency,
    maxRetries,
    retryDelay,
    autoStart,
    showProgress,
    showStorageStats,
    showNetworkStatus,
    onDownloadStart,
    onDownloadProgress,
    onDownloadComplete,
    onDownloadError,
    onBatchComplete,
    onStorageChange,
    customDownloadHandler,
    customProgressHandler,
  };

  return (
    <DownloadContext.Provider value={value}>
      {children}
    </DownloadContext.Provider>
  );
};

export const useDownloadContext = () => {
  const context = useContext(DownloadContext);
  if (context === undefined) {
    throw new Error(
      "useDownloadContext must be used within a DownloadProvider"
    );
  }
  return context;
};
