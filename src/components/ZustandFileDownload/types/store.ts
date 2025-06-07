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

  // 下载控制器
  abortControllers: Record<string, AbortController>;

  // Actions
  setFiles: (files: DownloadFile[]) => void;
  setFetchingFiles: (fetching: boolean) => void;
  updateFile: (fileId: string, updates: Partial<DownloadFile>) => void;
  addAbortController: (fileId: string, controller: AbortController) => void;
  removeAbortController: (fileId: string) => void;
  updateStorageUsage: (updates: Partial<StorageUsage>) => void;
  updateNetworkStatus: (
    updates: NetworkStatusUpdate,
    manuallySet?: boolean
  ) => boolean;
  resetManualFlag: () => void;
  toggleDisplayMode: () => void;
}
