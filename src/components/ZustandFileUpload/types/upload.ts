import type { UploadAuthConfig } from "../utils/auth";

export type { UploadAuthConfig };

export enum UploadStatus {
  // Waiting in queue.
  QUEUED = "queued",
  // Queued and waiting for actual upload.
  QUEUED_FOR_UPLOAD = "queued-for-upload",
  // Hashing/calculation stage.
  CALCULATING = "calculating",
  // Preparing upload request and chunks.
  PREPARING_UPLOAD = "preparing-upload",
  // Uploading chunks.
  UPLOADING = "uploading",
  // Paused by user or runtime condition.
  PAUSED = "paused",
  // Upload completed.
  DONE = "done",
  // Instant upload (already exists on server).
  INSTANT = "instant",
  // Upload failed.
  ERROR = "error",
  // Failed during merge stage.
  MERGE_ERROR = "merge-error",
}

export interface UploadFile {
  id: string; // Unique id
  fileName: string; // File name
  fileSize: number; // File size
  fileType: string; // MIME type
  lastModified: number; // Last modified timestamp
  status: UploadStatus; // Upload status
  progress: number; // Progress [0-100]
  hash?: string; // File hash
  chunkSize?: number; // Chunk size
  chunkCount?: number; // Total chunk count
  uploadedChunks?: number; // Uploaded chunk count
  pausedChunks?: number[]; // Uploaded chunk indexes while paused
  errorMessage?: string; // Error message
  createdAt: number; // Created timestamp
  order: number; // Queue order
  /**
   * 运行时文件引用（T3.1 起替代原 buffer 字段）：
   * 不持久化进 IndexedDB，仅当前会话内存持有；页面刷新即丢失，
   * 续传需用户重新选择同一文件（服务端分片检查决定跳过范围）。
   */
  fileRef?: File;
  /** 本条记录使用的哈希模式（影响队列 id / 服务端分片键，会话间不宜变更） */
  hashMode?: UploadHashMode;
  /** 刷新后等待用户重新选择文件：为 true 时 uploadAll 跳过并提示 */
  awaitingReselect?: boolean;
}

export interface ProcessingStats {
  total: number;
  processed: number;
  success: number;
  failed: number;
  oversized: number;
  startTime: number;
  endTime?: number;
  totalTime?: number;
}

export type UploadUIMode = "full" | "simple";
export type UploadSettingsSource = "localStorage" | "props";
/**
 * 文件哈希模式（T3.1）：
 * - "full"（默认）：全量流式哈希——按 1MB 分块顺序读入 Worker 增量计算，
 *   内存驻留与文件大小无关；哈希值与文件内容一一对应，服务端合并时强校验。
 * - "sample"：采样哈希——首 4MB + 中间 3 个 4MB 采样点 + 尾 4MB + 文件大小，
 *   大文件可跳过绝大部分读取；代价是存在极低概率的采样碰撞（同大小且采样
 *   区内容一致的不同文件会被视为同一文件），服务端合并时退化为
 *   「大小 + 逐分片 md5」校验（分片级仍全覆盖，不含糊）。
 */
export type UploadHashMode = "sample" | "full";

// Upload component props.
export interface ZustandFileUploadProps extends UploadAuthConfig {
  // API config
  baseURL?: string;
  uploadApi?: string;
  checkApi?: string;
  mergeApi?: string;

  // Network/upload tuning
  chunkSize?: number;
  fileConcurrency?: number;
  chunkConcurrency?: number;
  maxRetries?: number;
  /**
   * 文件哈希模式（T3.1）。默认 "full"（全量流式哈希，内存与文件大小无关）；
   * "sample" 为采样哈希，适合超大文件、可容忍极低概率采样碰撞的场景。
   */
  hashMode?: UploadHashMode;

  // File constraints
  maxFileSize?: number; // Per-file limit in bytes
  allowedFileTypes?: string[]; // Allowed MIME types/extensions
  maxFiles?: number; // Max file count

  // UI behavior
  autoUpload?: boolean;
  autoCleanup?: boolean;
  cleanupDelay?: number;
  networkDisplayMode?: "tooltip" | "direct";
  uiMode?: UploadUIMode;
  settingsSource?: UploadSettingsSource;
  /** 调试日志开关：默认 false。开启后 Worker 输出分片级日志（200ms 节流） */
  debug?: boolean;

  // Callbacks
  onUploadStart?: (files: UploadFile[]) => void;
  onUploadProgress?: (file: UploadFile, progress: number) => void;
  onUploadComplete?: (file: UploadFile, success: boolean) => void;
  onUploadError?: (file: UploadFile, error: string) => void;
  onBatchComplete?: (results: {
    success: number;
    failed: number;
    total: number;
  }) => void;

  // Custom handlers
  customFileValidator?: (file: File) => { valid: boolean; message?: string };
  customUploadHandler?: (
    file: UploadFile,
    config: UploadConfig
  ) => Promise<boolean>;
}

// Internal upload config.
export interface UploadConfig {
  baseURL: string;
  uploadApi: string;
  checkApi: string;
  mergeApi: string;
  chunkSize: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  maxRetries: number;
  /** 文件哈希模式：full=全量流式（默认），sample=采样。见 UploadHashMode 说明 */
  hashMode: UploadHashMode;
  maxFileSize: number;
  allowedFileTypes: string[];
  maxFiles: number;
  /** 是否以 credentials:'include' 发送请求（携带 Cookie）。默认 false。见 utils/auth.ts 说明。 */
  withCredentials?: boolean;
  /** 调试日志开关（Worker 内分片级日志，200ms 节流）。默认 false。 */
  debug?: boolean;
}

export const statusMap: Record<string, { text: string; color: string }> = {
  queued: { text: "排队中", color: "default" },
  "queued-for-upload": { text: "待上传", color: "default" },
  calculating: { text: "计算中", color: "processing" },
  "preparing-upload": { text: "准备上传", color: "processing" },
  uploading: { text: "上传中", color: "processing" },
  paused: { text: "已暂停", color: "orange" },
  done: { text: "已完成", color: "green" },
  instant: { text: "秒传成功", color: "cyan" },
  error: { text: "上传失败", color: "red" },
  "merge-error": { text: "合并失败", color: "red" },
};

export type AlignItem = "left" | "center" | "right";

export interface BatchInfo {
  current: number; // Processed count
  total: number; // Total count
  queued: number; // Queued count
  active: number; // Active count
  completed: number; // Completed count
  failed: number; // Failed count
  retried: number; // Retried count
  countdown?: number; // Cleanup countdown in seconds
}

export interface ProcessProgress {
  processed: number;
  total: number;
  success: number;
  failed: number;
  oversized: number;
}
