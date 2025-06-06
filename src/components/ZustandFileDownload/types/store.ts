import { DownloadFile } from "./download";

// 存储使用情况接口
export interface StorageUsage {
  usage: number;
  quota: number;
  percent: number;
  isLoading: boolean;
  lastUpdated: number;
  estimatedUsage: number;
}

// 下载状态接口
export interface DownloadState {
  // 文件列表
  files: DownloadFile[];
  storedFiles: DownloadFile[];
  fetchingFiles: boolean;

  // 存储使用情况
  storageUsage: StorageUsage;

  // 下载控制器
  abortControllers: Record<string, AbortController>;

  // Actions
  setFiles: (files: DownloadFile[]) => void;
  setStoredFiles: (files: DownloadFile[]) => void;
  setFetchingFiles: (fetching: boolean) => void;
  updateFile: (fileId: string, updates: Partial<DownloadFile>) => void;
  addAbortController: (fileId: string, controller: AbortController) => void;
  removeAbortController: (fileId: string) => void;
  updateStorageUsage: (updates: Partial<StorageUsage>) => void;
  updateLocalSizeEstimate: (sizeChange: number) => void;
  resetStorageEstimate: () => void;
}
