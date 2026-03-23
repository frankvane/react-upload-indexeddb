/* eslint-disable react-refresh/only-export-components */
import React, { createContext } from "react";
import {
  UploadConfig,
  UploadSettingsSource,
  UploadUIMode,
  ZustandFileUploadProps,
} from "../types/upload";
import { API_BASE_URL, API_PATHS } from "../../../config/api";

const DEFAULT_CONFIG: UploadConfig = {
  baseURL: API_BASE_URL,
  uploadApi: API_PATHS.file.upload,
  checkApi: API_PATHS.file.instant,
  chunkSize: 1024 * 1024,
  fileConcurrency: 2,
  chunkConcurrency: 2,
  maxRetries: 3,
  maxFileSize: 100 * 1024 * 1024,
  allowedFileTypes: [],
  maxFiles: 100,
};

export interface UploadContextType extends UploadConfig {
  onUploadStart?: ZustandFileUploadProps["onUploadStart"];
  onUploadProgress?: ZustandFileUploadProps["onUploadProgress"];
  onUploadComplete?: ZustandFileUploadProps["onUploadComplete"];
  onUploadError?: ZustandFileUploadProps["onUploadError"];
  onBatchComplete?: ZustandFileUploadProps["onBatchComplete"];
  customFileValidator?: ZustandFileUploadProps["customFileValidator"];
  customUploadHandler?: ZustandFileUploadProps["customUploadHandler"];
  autoUpload: boolean;
  autoCleanup: boolean;
  cleanupDelay: number;
  networkDisplayMode: "tooltip" | "direct";
  uiMode: UploadUIMode;
  settingsSource: UploadSettingsSource;
}

export const UploadContext = createContext<UploadContextType | undefined>(
  undefined
);

interface UploadProviderProps extends ZustandFileUploadProps {
  children: React.ReactNode;
}

export const UploadProvider: React.FC<UploadProviderProps> = ({
  children,
  baseURL = DEFAULT_CONFIG.baseURL,
  uploadApi = DEFAULT_CONFIG.uploadApi,
  checkApi = DEFAULT_CONFIG.checkApi,
  chunkSize = DEFAULT_CONFIG.chunkSize,
  fileConcurrency = DEFAULT_CONFIG.fileConcurrency,
  chunkConcurrency = DEFAULT_CONFIG.chunkConcurrency,
  maxRetries = DEFAULT_CONFIG.maxRetries,
  maxFileSize = DEFAULT_CONFIG.maxFileSize,
  allowedFileTypes = DEFAULT_CONFIG.allowedFileTypes,
  maxFiles = DEFAULT_CONFIG.maxFiles,
  autoUpload = true,
  autoCleanup = true,
  cleanupDelay = 10,
  networkDisplayMode = "tooltip",
  uiMode = "full",
  settingsSource = "localStorage",
  onUploadStart,
  onUploadProgress,
  onUploadComplete,
  onUploadError,
  onBatchComplete,
  customFileValidator,
  customUploadHandler,
}) => {
  const value: UploadContextType = {
    baseURL,
    uploadApi,
    checkApi,
    chunkSize,
    fileConcurrency,
    chunkConcurrency,
    maxRetries,
    maxFileSize,
    allowedFileTypes,
    maxFiles,
    autoUpload,
    autoCleanup,
    cleanupDelay,
    networkDisplayMode,
    uiMode,
    settingsSource,
    onUploadStart,
    onUploadProgress,
    onUploadComplete,
    onUploadError,
    onBatchComplete,
    customFileValidator,
    customUploadHandler,
  };

  return (
    <UploadContext.Provider value={value}>{children}</UploadContext.Provider>
  );
};
