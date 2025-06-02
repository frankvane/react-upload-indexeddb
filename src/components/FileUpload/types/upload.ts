export enum UploadStatus {
  // 上传已排队
  QUEUED = "queued",
  // 上传已排队等待上传
  QUEUED_FOR_UPLOAD = "queued-for-upload",
  // 正在计算
  CALCULATING = "calculating",
  // 正在准备上传
  PREPARING_UPLOAD = "preparing-upload",
  // 正在上传
  UPLOADING = "uploading",
  // 已暂停
  PAUSED = "paused",
  // 已完成
  DONE = "done",
  // 即时上传
  INSTANT = "instant",
  // 错误
  ERROR = "error",
  // 合并错误
  MERGE_ERROR = "merge-error",
}

export interface UploadFile {
  id: string; // 唯一ID
  fileName: string; // 文件名
  fileSize: number; // 文件大小
  fileType: string; // 文件类型
  lastModified: number; // 最后修改时间
  status: UploadStatus; // 上传状态
  progress: number; // 上传进度 (0-100)
  hash?: string; // 文件哈希值
  chunkSize?: number; // 分片大小
  chunkCount?: number; // 分片总数
  uploadedChunks?: number; // 已上传分片数
  pausedChunks?: number[]; // 暂停时已上传的分片索引
  errorMessage?: string; // 错误信息
  createdAt: number; // 创建时间戳
  order: number; // 上传顺序
  buffer?: ArrayBuffer; // 文件二进制内容
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

export interface FileSelectorProps {
  onFilesSelected: (files: FileList) => void;
  totalFilesCount?: number; // 总文件数
  completedFilesCount?: number; // 已处理文件数
}

export interface FileProgress {
  uid: string;
  name: string;
  size: number;
  status: string;
  percent: number;
  hash?: string;
  message?: string;
}

export const statusMap: Record<string, { text: string; color: string }> = {
  queued: { text: "排队中", color: "default" },
  "queued-for-upload": { text: "等待上传", color: "default" },
  calculating: { text: "计算中", color: "processing" },
  "preparing-upload": { text: "准备上传", color: "processing" },
  uploading: { text: "上传中", color: "processing" },
  paused: { text: "已暂停", color: "orange" },
  done: { text: "已完成", color: "green" },
  instant: { text: "秒传", color: "cyan" },
  error: { text: "错误", color: "red" },
  "merge-error": { text: "合并错误", color: "red" },
};

export type AlignItem = "left" | "center" | "right";
