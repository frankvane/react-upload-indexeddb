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
  buffer?: ArrayBuffer; // File binary buffer
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

// Upload component props.
export interface ZustandFileUploadProps {
  // API config
  baseURL?: string;
  uploadApi?: string;
  checkApi?: string;

  // Network/upload tuning
  chunkSize?: number;
  fileConcurrency?: number;
  chunkConcurrency?: number;
  maxRetries?: number;

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
  chunkSize: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  maxRetries: number;
  maxFileSize: number;
  allowedFileTypes: string[];
  maxFiles: number;
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
