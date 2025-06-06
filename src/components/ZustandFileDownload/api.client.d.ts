/**
 * API客户端类型声明
 */

export interface FileInfo {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileExt?: string;
  thumbnailUrl?: string | null;
  md5?: string;
  createdAt?: string | number;
}

export interface DownloadInfo {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileExt: string;
  md5: string;
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

export interface PreparedDownloadInfo {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  md5: string;
  lastModified: string;
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

export interface FileListResponse {
  total: number;
  page: number;
  limit: number;
  files: FileInfo[];
}

/**
 * 获取可下载文件列表
 */
export function getFileList(
  params?: Record<string, any>
): Promise<FileListResponse>;

/**
 * 获取文件信息
 */
export function getFileInfo(fileId: string): Promise<FileInfo>;

/**
 * 获取下载信息（支持断点续传）
 */
export function getDownloadInfo(fileId: string): Promise<DownloadInfo>;

/**
 * 创建下载URL
 */
export function createDownloadUrl(fileId: string): string;

/**
 * 创建分片下载URL
 */
export function createChunkDownloadUrl(
  fileId: string,
  index: number,
  chunkSize: number
): string;

/**
 * 获取下载文件列表（格式化为ZustandFileDownload组件使用的格式）
 */
export function getDownloadFiles(params?: Record<string, any>): Promise<
  Array<{
    id: string;
    url: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    metadata: {
      fileExt?: string;
      thumbnailUrl?: string | null;
      md5?: string;
      createdAt?: string | number;
    };
  }>
>;

/**
 * 检查文件是否支持断点续传
 */
export function checkResumeSupport(fileId: string): Promise<boolean>;

/**
 * 获取文件下载预处理信息
 */
export function prepareDownload(fileId: string): Promise<PreparedDownloadInfo>;

declare const api: {
  getFileList: typeof getFileList;
  getFileInfo: typeof getFileInfo;
  getDownloadInfo: typeof getDownloadInfo;
  createDownloadUrl: typeof createDownloadUrl;
  createChunkDownloadUrl: typeof createChunkDownloadUrl;
  getDownloadFiles: typeof getDownloadFiles;
  checkResumeSupport: typeof checkResumeSupport;
  prepareDownload: typeof prepareDownload;
};

export default api;
