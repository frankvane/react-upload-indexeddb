import { useUploadContext } from "../context/UploadContext";
import { useUploadStore } from "../store/upload";
import { useCallback } from "react";

/**
 * 获取有效的上传配置
 * 优先级：Store 中的用户修改值 > Context 中的 Props 初始值
 */
export const useEffectiveUploadConfig = () => {
  const contextConfig = useUploadContext();

  // 使用 useCallback 缓存选择器函数以避免无限循环
  const storeSelector = useCallback((state: any) => ({
    autoUpload: state.autoUpload,
    autoCleanup: state.autoCleanup,
    cleanupDelay: state.cleanupDelay,
    networkDisplayMode: state.networkDisplayMode,
    chunkSize: state.chunkSize,
    fileConcurrency: state.fileConcurrency,
    chunkConcurrency: state.chunkConcurrency,
    maxRetries: state.maxRetries,
  }), []);

  const storeConfig = useUploadStore(storeSelector);

  // 合并配置：Store 优先，Context 作为后备
  return {
    // API 配置（通常不允许运行时修改）
    baseURL: contextConfig.baseURL,
    uploadApi: contextConfig.uploadApi,
    checkApi: contextConfig.checkApi,
    
    // 文件限制配置（通常不允许运行时修改）
    maxFileSize: contextConfig.maxFileSize,
    allowedFileTypes: contextConfig.allowedFileTypes,
    maxFiles: contextConfig.maxFiles,
    
    // 网络参数配置（可能允许运行时修改，但通常使用 Context 值）
    chunkSize: storeConfig.chunkSize,
    fileConcurrency: storeConfig.fileConcurrency,
    chunkConcurrency: storeConfig.chunkConcurrency,
    maxRetries: storeConfig.maxRetries,
    
    // UI 配置（允许运行时修改）
    autoUpload: storeConfig.autoUpload,
    autoCleanup: storeConfig.autoCleanup,
    cleanupDelay: storeConfig.cleanupDelay,
    networkDisplayMode: storeConfig.networkDisplayMode,
    
    // 回调函数（来自 Context）
    onUploadStart: contextConfig.onUploadStart,
    onUploadProgress: contextConfig.onUploadProgress,
    onUploadComplete: contextConfig.onUploadComplete,
    onUploadError: contextConfig.onUploadError,
    onBatchComplete: contextConfig.onBatchComplete,
    
    // 自定义方法（来自 Context）
    customFileValidator: contextConfig.customFileValidator,
    customUploadHandler: contextConfig.customUploadHandler,
  };
};
