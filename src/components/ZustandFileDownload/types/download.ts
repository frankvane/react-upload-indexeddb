// 下载状态枚举
export const DownloadStatus = {
  IDLE: "idle",
  PREPARING: "preparing",
  DOWNLOADING: "downloading",
  PAUSED: "paused",
  COMPLETED: "completed",
  ERROR: "error",
} as const;

export type DownloadStatusType =
  (typeof DownloadStatus)[keyof typeof DownloadStatus];

// 文件分片大小（5MB）
export const CHUNK_SIZE = 5 * 1024 * 1024;

// 下载文件接口
export interface DownloadFile {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType?: string;
  totalChunks: number;
  chunkSize?: number;
  downloadedChunks?: number;
  progress?: number;
  status: DownloadStatusType;
  completedAt?: number;
  error?: string;
}

// Worker消息类型
export type WorkerMessageType =
  | "START_DOWNLOAD"
  | "PAUSE_DOWNLOAD"
  | "RESUME_DOWNLOAD"
  | "MERGE_FILE"
  | "CANCEL";

export type WorkerResponseType =
  | "PROGRESS"
  | "COMPLETE"
  | "ERROR"
  | "CHUNK_DOWNLOADED"
  | "MERGE_PROGRESS"
  | "MERGE_COMPLETE";

export interface WorkerMessage {
  type: WorkerMessageType;
  payload: any;
}

export interface WorkerResponse {
  type: WorkerResponseType;
  payload: any;
}

// 批次下载信息
export interface BatchDownloadInfo {
  current: number; // 当前已处理数量
  total: number; // 总数量
  queued: number; // 队列中数量
  active: number; // 活动中数量
  completed: number; // 已完成数量
  failed: number; // 失败数量
  paused: number; // 暂停数量
  downloading: number; // 正在下载数量
  speed?: number; // 下载速度 (bytes/s)
  estimatedTime?: number; // 预计剩余时间 (秒)
}

// 存储统计信息
export interface StorageStats {
  used: number; // 已使用空间 (bytes)
  available: number; // 可用空间 (bytes)
  total: number; // 总空间 (bytes)
  percentage: number; // 使用百分比
}

// 下载组件配置接口
export interface ZustandFileDownloadProps {
  // API 配置
  baseURL?: string;
  listApi?: string;
  downloadApi?: string;

  // 下载参数配置
  chunkSize?: number; // 分片大小
  maxConcurrency?: number; // 最大并发数
  maxRetries?: number; // 最大重试次数
  retryDelay?: number; // 重试延迟时间

  // UI 配置
  autoStart?: boolean; // 是否自动开始下载
  showProgress?: boolean; // 是否显示进度
  showStorageStats?: boolean; // 是否显示存储统计
  showNetworkStatus?: boolean; // 是否显示网络状态

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

// 下载配置接口
export interface DownloadConfig {
  baseURL: string;
  listApi: string;
  downloadApi: string;
  chunkSize: number;
  maxConcurrency: number;
  maxRetries: number;
  retryDelay: number;
}
