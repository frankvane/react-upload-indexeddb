/**
 * API客户端类型定义文件
 */

export interface FileListParams {
  page?: number;
  limit?: number;
  search?: string;
  category_id?: string;
}

export interface FileItem {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileExt?: string;
  url?: string;
  thumbnailUrl?: string | null;
  md5?: string;
  createdAt: string;
}

export interface FileListResponse {
  files: FileItem[];
  total: number;
  page: number;
  limit: number;
}

export interface DownloadInfo {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileExt?: string;
  md5?: string;
  lastModified: string;
  supportsRanges: boolean;
  recommendedChunkSize: number;
  totalChunks: number;
  urls: {
    download: string;
    chunk: string;
    info: string;
  };
}

export interface DownloadFileItem {
  id: string;
  url: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  metadata?: {
    fileExt?: string;
    thumbnailUrl?: string | null;
    md5?: string;
    createdAt?: string;
  };
}

export interface DownloadPreparation {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  md5?: string;
  lastModified?: string;
  resumeSupported: boolean;
  chunkSize: number;
  totalChunks: number;
  downloadUrl: string;
  chunkUrl: string;
  chunks: Array<{
    index: number;
    start: number;
    end: number;
    size: number;
    downloaded: number;
    status: string;
  }>;
}

declare const apiClient: {
  getFileList: (params?: FileListParams) => Promise<FileListResponse>;
  getFileInfo: (fileId: string) => Promise<FileItem>;
  getDownloadInfo: (fileId: string) => Promise<DownloadInfo>;
  createDownloadUrl: (fileId: string) => string;
  createChunkDownloadUrl: (
    fileId: string,
    index: number,
    chunkSize: number
  ) => string;
  getDownloadFiles: (params?: FileListParams) => Promise<DownloadFileItem[]>;
  checkResumeSupport: (fileId: string) => Promise<boolean>;
  prepareDownload: (fileId: string) => Promise<DownloadPreparation>;
};

export default apiClient;
