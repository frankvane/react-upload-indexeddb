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
