import { DownloadFile } from "./download";

// 存储使用情况接口
export interface StorageUsage {
  usage: number;
  quota: number;
  percent: number;
  isLoading: boolean;
  lastUpdated: number;
}

// 网络状态更新接口
export interface NetworkStatusUpdate {
  networkType?: string;
  chunkSize?: number;
  fileConcurrency?: number;
  chunkConcurrency?: number;
  isNetworkOffline?: boolean;
  isManuallySet?: boolean;
  displayMode?: "tooltip" | "direct";
}

// 下载状态接口
export interface DownloadState {
  // 文件列表
  files: DownloadFile[];
  fetchingFiles: boolean;

  // 文件列表请求状态
  lastFetchTime: number;
  isFetchingFileList: boolean;

  // 存储使用情况
  storageUsage: StorageUsage;

  // 网络状态
  networkType: string;
  chunkSize: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  isNetworkOffline: boolean;
  isManuallySet: boolean; // 是否手动设置网络参数
  displayMode: "tooltip" | "direct"; // 网络状态显示模式

  // 下载参数配置
  maxConcurrency: number; // 最大并发数
  maxRetries: number; // 最大重试次数
  retryDelay: number; // 重试延迟时间

  // UI 配置
  autoStart: boolean; // 是否自动开始下载
  showProgress: boolean; // 是否显示进度
  showStorageStats: boolean; // 是否显示存储统计
  showNetworkStatus: boolean; // 是否显示网络状态

  // 下载控制器
  abortControllers: Record<string, AbortController>;

  // Actions
  setFiles: (files: DownloadFile[]) => void;
  setFetchingFiles: (fetching: boolean) => void;
  updateFile: (fileId: string, updates: Partial<DownloadFile>) => void;
  addAbortController: (fileId: string, controller: AbortController) => void;
  removeAbortController: (fileId: string) => void;
  updateStorageUsage: (updates: Partial<StorageUsage>) => void;
  fetchDownloadFiles: (
    params?: Record<string, any>,
    forceUpdate?: boolean
  ) => Promise<DownloadFile[]>;
  updateNetworkStatus: (
    updates: NetworkStatusUpdate,
    manuallySet?: boolean
  ) => boolean;
  resetManualFlag: () => void;
  toggleDisplayMode: () => void;

  // 配置设置方法
  setMaxConcurrency: (maxConcurrency: number) => void;
  setMaxRetries: (maxRetries: number) => void;
  setRetryDelay: (retryDelay: number) => void;
  setAutoStart: (autoStart: boolean) => void;
  setShowProgress: (showProgress: boolean) => void;
  setShowStorageStats: (showStorageStats: boolean) => void;
  setShowNetworkStatus: (showNetworkStatus: boolean) => void;
}
