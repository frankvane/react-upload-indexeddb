/* eslint-disable react-refresh/only-export-components */
import React, { createContext } from "react";
import {
  ZustandFileDownloadProps,
  DownloadFile,
  StorageStats,
  DownloadConfig,
} from "../types/download";
import { API_BASE_URL, API_PATHS } from "../../../config/api";

export interface DownloadContextType {
  baseURL: string;
  listApi: string;
  downloadApi: string;
  chunkSize: number;
  maxConcurrency: number;
  maxRetries: number;
  retryDelay: number;
  autoStart: boolean;
  showProgress: boolean;
  showStorageStats: boolean;
  showNetworkStatus: boolean;
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
  customDownloadHandler?: (
    file: DownloadFile,
    config: DownloadConfig
  ) => Promise<boolean>;
  customProgressHandler?: (file: DownloadFile, progress: number) => void;
}

export const DownloadContext = createContext<DownloadContextType | undefined>(
  undefined
);

interface DownloadProviderProps extends ZustandFileDownloadProps {
  children: React.ReactNode;
}

export const DownloadProvider: React.FC<DownloadProviderProps> = ({
  children,
  baseURL = API_BASE_URL,
  listApi = API_PATHS.file.list,
  downloadApi = API_PATHS.file.download,
  chunkSize = 5 * 1024 * 1024,
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
    <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>
  );
};
