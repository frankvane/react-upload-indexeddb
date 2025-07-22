import { useDownloadContext } from "../context/DownloadContext";
import { useDownloadStore } from "../store";
import { useMemo } from "react";

/**
 * 获取有效的下载配置
 *
 * 这个 Hook 负责合并来自不同来源的配置：
 * 1. Context 配置（通过 DownloadProvider 传入的 props）
 * 2. Store 配置（运行时可修改的配置）
 *
 * 优先级：Store 配置 > Context 配置 > 默认值
 *
 * @returns 合并后的最终配置对象
 */
export const useEffectiveDownloadConfig = () => {
  // 获取 Context 中的配置（来自组件 props）
  const contextConfig = useDownloadContext();

  // 获取 Store 中的配置（运行时可修改）
  const chunkSize = useDownloadStore((state) => state.chunkSize);
  const maxConcurrency = useDownloadStore((state) => state.maxConcurrency);
  const maxRetries = useDownloadStore((state) => state.maxRetries);
  const retryDelay = useDownloadStore((state) => state.retryDelay);
  const autoStart = useDownloadStore((state) => state.autoStart);
  const showProgress = useDownloadStore((state) => state.showProgress);
  const showStorageStats = useDownloadStore((state) => state.showStorageStats);
  const showNetworkStatus = useDownloadStore(
    (state) => state.showNetworkStatus
  );

  // 使用 useMemo 缓存合并后的最终配置对象
  return useMemo(
    () => ({
      // API 配置（通常不允许运行时修改）
      baseURL: contextConfig.baseURL,
      listApi: contextConfig.listApi,
      downloadApi: contextConfig.downloadApi,

      // 下载参数配置（可能允许运行时修改，但通常使用 Context 值）
      chunkSize: chunkSize || contextConfig.chunkSize,
      maxConcurrency: maxConcurrency || contextConfig.maxConcurrency,
      maxRetries: maxRetries || contextConfig.maxRetries,
      retryDelay: retryDelay || contextConfig.retryDelay,

      // UI 配置（允许运行时修改）
      autoStart: autoStart ?? contextConfig.autoStart,
      showProgress: showProgress ?? contextConfig.showProgress,
      showStorageStats: showStorageStats ?? contextConfig.showStorageStats,
      showNetworkStatus: showNetworkStatus ?? contextConfig.showNetworkStatus,

      // 回调事件（来自 Context）
      onDownloadStart: contextConfig.onDownloadStart,
      onDownloadProgress: contextConfig.onDownloadProgress,
      onDownloadComplete: contextConfig.onDownloadComplete,
      onDownloadError: contextConfig.onDownloadError,
      onBatchComplete: contextConfig.onBatchComplete,
      onStorageChange: contextConfig.onStorageChange,

      // 自定义方法（来自 Context）
      customDownloadHandler: contextConfig.customDownloadHandler,
      customProgressHandler: contextConfig.customProgressHandler,
    }),
    [
      contextConfig.baseURL,
      contextConfig.listApi,
      contextConfig.downloadApi,
      contextConfig.chunkSize,
      contextConfig.maxConcurrency,
      contextConfig.maxRetries,
      contextConfig.retryDelay,
      contextConfig.autoStart,
      contextConfig.showProgress,
      contextConfig.showStorageStats,
      contextConfig.showNetworkStatus,
      contextConfig.onDownloadStart,
      contextConfig.onDownloadProgress,
      contextConfig.onDownloadComplete,
      contextConfig.onDownloadError,
      contextConfig.onBatchComplete,
      contextConfig.onStorageChange,
      contextConfig.customDownloadHandler,
      contextConfig.customProgressHandler,
      chunkSize,
      maxConcurrency,
      maxRetries,
      retryDelay,
      autoStart,
      showProgress,
      showStorageStats,
      showNetworkStatus,
    ]
  );
};
