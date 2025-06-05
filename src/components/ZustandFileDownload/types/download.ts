/**
 * ZustandFileDownload 类型定义文件
 */

/**
 * 下载状态枚举
 */
export enum DownloadStatus {
  QUEUED = "QUEUED", // 已加入队列
  PREPARING = "PREPARING", // 准备下载
  DOWNLOADING = "DOWNLOADING", // 下载中
  PAUSED = "PAUSED", // 已暂停
  COMPLETED = "COMPLETED", // 已完成
  FAILED = "FAILED", // 下载失败
  CANCELED = "CANCELED", // 已取消
  NETWORK_ERROR = "NETWORK_ERROR", // 网络错误
  COMPLETED_CHUNKS = "COMPLETED_CHUNKS", // 分片下载完成
  MERGING = "MERGING", // 合并中
  MERGE_ERROR = "MERGE_ERROR", // 合并错误
}

/**
 * 网络类型枚举
 */
export enum NetworkType {
  UNKNOWN = "unknown",
  ETHERNET = "ethernet",
  WIFI = "wifi",
  CELLULAR = "cellular",
  CELLULAR_2G = "2g",
  CELLULAR_3G = "3g",
  CELLULAR_4G = "4g",
  CELLULAR_5G = "5g",
  OFFLINE = "offline",
}

/**
 * 下载任务接口
 */
export interface DownloadTask {
  id: string; // 任务ID
  url: string; // 下载URL
  fileName: string; // 文件名
  fileSize: number; // 文件大小(字节)
  mimeType?: string; // MIME类型
  status: DownloadStatus; // 下载状态
  progress: number; // 下载进度(0-100)
  chunks: DownloadChunk[]; // 分片信息
  createdAt: number; // 创建时间
  startedAt?: number; // 开始时间
  completedAt?: number; // 完成时间
  error?: string; // 错误信息
  retryCount: number; // 重试次数
  priority: number; // 优先级(数字越小优先级越高)
  speed: number; // 下载速度(bytes/s)
  timeRemaining?: number; // 预计剩余时间(ms)
  etag?: string; // ETag
  lastModified?: string; // Last-Modified
  resumeSupported: boolean; // 是否支持断点续传
  metadata?: Record<string, any>; // 额外元数据
}

/**
 * 下载分片接口
 */
export interface DownloadChunk {
  id: string; // 分片ID
  taskId: string; // 所属任务ID
  index: number; // 分片索引
  start: number; // 起始位置(字节)
  end: number; // 结束位置(字节)
  size: number; // 分片大小(字节)
  downloaded: number; // 已下载大小(字节)
  status: DownloadStatus; // 分片状态
  storageType: "indexeddb" | "filesystem"; // 存储类型
  storagePath?: string; // 存储路径
  retryCount: number; // 重试次数
  error?: string; // 错误信息
  checksum?: string; // 校验和
}

/**
 * 批次信息接口
 */
export interface BatchInfo {
  current: number; // 当前处理数量
  total: number; // 总数量
  queued: number; // 队列中数量
  active: number; // 活跃下载数量
  completed: number; // 已完成数量
  failed: number; // 失败数量
  retried: number; // 重试数量
  countdown?: number; // 倒计时(秒)
  averageSpeed?: number; // 平均速度(bytes/s)
  totalSize?: number; // 总大小(字节)
  downloadedSize?: number; // 已下载大小(字节)
}

/**
 * 存储使用情况接口
 */
export interface StorageUsage {
  indexedDBUsage: number; // IndexedDB使用量(字节)
  fileSystemUsage: number; // FileSystem使用量(字节)
  quota: number; // 总配额(字节)
  usagePercentage: number; // 使用百分比(0-100)
  availableSpace: number; // 可用空间(字节)
  tasks: {
    // 按任务分类的使用情况
    id: string;
    fileName: string;
    size: number;
  }[];
}

/**
 * 下载配置接口
 */
export interface DownloadConfig {
  chunkSize: number; // 默认分片大小(字节)
  maxConcurrentDownloads: number; // 最大并发下载文件数
  maxConcurrentChunks: number; // 每个文件最大并发分片数
  autoStart: boolean; // 是否自动开始下载
  storageQuota: number; // 存储配额(字节)
  retryTimes: number; // 失败重试次数
  retryDelay: number; // 重试延迟(毫秒)
  autoCleanup: boolean; // 是否自动清理已完成的下载
  cleanupDelay: number; // 自动清理延迟(毫秒)
  useFileSystemAPI: boolean; // 是否使用FileSystem API
  validateChunks: boolean; // 是否验证分片完整性
  networkAdaptive: boolean; // 是否启用网络自适应
  smallFileThreshold: number; // 小文件阈值(字节)
  largeFileThreshold: number; // 大文件阈值(字节)
  downloadDirectory?: string; // 下载目录(仅支持Origin Private File System)
}

/**
 * 下载状态接口
 */
export interface DownloadState {
  // 下载任务
  downloadTasks: DownloadTask[];
  // 网络状态
  isNetworkOffline: boolean;
  networkType: NetworkType;
  // 下载统计
  activeDownloads: number;
  completedDownloads: number;
  failedDownloads: number;
  pausedDownloads: number;
  totalProgress: number;
  // 批次信息
  batchInfo: BatchInfo | null;
  // 配置
  config: DownloadConfig;
  // 状态标志
  isDownloading: boolean;
  isMerging: boolean;
  // 进度映射
  progressMap: Record<string, number>;
  // 消息API
  messageApi: any;
}

/**
 * 添加下载任务参数
 */
export interface AddDownloadTaskParams {
  url: string; // 下载URL
  fileName: string; // 文件名
  fileSize?: number; // 文件大小(字节)，可选，如不提供会自动获取
  mimeType?: string; // MIME类型，可选
  priority?: number; // 优先级，可选，默认为0
  metadata?: Record<string, any>; // 额外元数据，可选
}

/**
 * 断点信息接口
 */
export interface ResumeInfo {
  taskId: string; // 任务ID
  url: string; // 下载URL
  fileName: string; // 文件名
  fileSize: number; // 文件大小(字节)
  etag?: string; // ETag
  lastModified?: string; // Last-Modified
  chunks: {
    // 分片信息
    index: number; // 分片索引
    start: number; // 起始位置(字节)
    end: number; // 结束位置(字节)
    downloaded: number; // 已下载大小(字节)
    status: DownloadStatus; // 分片状态
  }[];
  timestamp: number; // 保存时间戳
}

/**
 * 下载进度事件
 */
export interface DownloadProgressEvent {
  taskId: string; // 任务ID
  chunkIndex?: number; // 分片索引
  loaded: number; // 已加载大小(字节)
  total: number; // 总大小(字节)
  progress: number; // 进度(0-100)
  speed: number; // 速度(bytes/s)
  timeRemaining?: number; // 预计剩余时间(ms)
}

/**
 * Worker消息类型
 */
export type WorkerMessageType =
  | "download" // 下载任务
  | "pause" // 暂停下载
  | "resume" // 恢复下载
  | "cancel" // 取消下载
  | "merge" // 合并分片
  | "progress" // 进度更新
  | "done" // 下载完成
  | "error" // 下载错误
  | "network-status" // 网络状态变化
  | "debug" // 调试信息
  | "store-chunk"; // 存储分片数据

/**
 * Worker消息接口
 */
export interface WorkerMessage {
  type: WorkerMessageType; // 消息类型
  taskId?: string; // 任务ID
  chunkIndex?: number; // 分片索引
  data?: any; // 消息数据
  error?: string; // 错误信息
  progress?: number; // 进度
  message?: string; // 消息内容
  transferable?: boolean; // 是否包含可转移对象
}

/**
 * 组件属性接口
 */
export interface ZustandFileDownloadProps {
  config?: Partial<DownloadConfig>; // 下载配置
  onComplete?: (file: DownloadTask) => void; // 下载完成回调
  onError?: (error: Error, file?: DownloadTask) => void; // 错误处理回调
  onProgress?: (progress: number, file?: DownloadTask) => void; // 进度更新回调
  className?: string; // 自定义CSS类名
  style?: React.CSSProperties; // 自定义内联样式
  showUI?: boolean; // 是否显示UI组件
  showFileList?: boolean; // 是否显示文件列表面板
  autoLoadFiles?: boolean; // 是否自动加载文件列表
  theme?: "light" | "dark"; // 主题
}
