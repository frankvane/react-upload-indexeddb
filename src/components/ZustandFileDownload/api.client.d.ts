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
 * 获取下载信息（支持断点续传）
 */
export function getDownloadInfo(fileId: string): Promise<DownloadInfo>;

/**
 * 创建下载URL
 */
export function createDownloadUrl(fileId: string): string;

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

declare const api: {
  getFileList: typeof getFileList;
  getDownloadInfo: typeof getDownloadInfo;
  createDownloadUrl: typeof createDownloadUrl;
  getDownloadFiles: typeof getDownloadFiles;
};

export default api;
