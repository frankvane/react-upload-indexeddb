import React, { createContext, useContext } from "react";
import { UploadConfig, ZustandFileUploadProps } from "../types/upload";

// 默认配置
const DEFAULT_CONFIG: UploadConfig = {
  baseURL: "http://localhost:3000",
  uploadApi: "/api/upload",
  checkApi: "/api/upload/check",
  chunkSize: 1024 * 1024, // 1MB
  fileConcurrency: 2,
  chunkConcurrency: 2,
  maxRetries: 3,
  maxFileSize: 100 * 1024 * 1024, // 100MB
  allowedFileTypes: [], // 空数组表示允许所有类型
  maxFiles: 100,
};

// Context 类型定义
interface UploadContextType extends UploadConfig {
  // 回调事件
  onUploadStart?: ZustandFileUploadProps['onUploadStart'];
  onUploadProgress?: ZustandFileUploadProps['onUploadProgress'];
  onUploadComplete?: ZustandFileUploadProps['onUploadComplete'];
  onUploadError?: ZustandFileUploadProps['onUploadError'];
  onBatchComplete?: ZustandFileUploadProps['onBatchComplete'];
  
  // 自定义方法
  customFileValidator?: ZustandFileUploadProps['customFileValidator'];
  customUploadHandler?: ZustandFileUploadProps['customUploadHandler'];
  
  // UI 配置
  autoUpload: boolean;
  autoCleanup: boolean;
  cleanupDelay: number;
  networkDisplayMode: "tooltip" | "direct";
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

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
    onUploadStart,
    onUploadProgress,
    onUploadComplete,
    onUploadError,
    onBatchComplete,
    customFileValidator,
    customUploadHandler,
  };

  return (
    <UploadContext.Provider value={value}>
      {children}
    </UploadContext.Provider>
  );
};

// Hook 用于获取上传配置
export const useUploadContext = (): UploadContextType => {
  const context = useContext(UploadContext);
  if (context === undefined) {
    throw new Error('useUploadContext must be used within an UploadProvider');
  }
  return context;
};

// Hook 用于获取运行时有效配置（Store 优先，然后是 Context）
export const useEffectiveUploadConfig = () => {
  const contextConfig = useUploadContext();
  // 这里我们需要导入 useUploadStore，但为了避免循环依赖，我们在使用的地方实现这个逻辑
  return contextConfig;
};

export default UploadContext;
