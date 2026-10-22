import axios from "axios";
import { API_BASE_URL, API_PATHS, buildApiUrl } from "../../config/api";

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

export interface FileListResponse {
  total: number;
  files: FileInfo[];
}

export interface DownloadListItem {
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
}

interface RuntimeConfig {
  baseURL: string;
  listApi: string;
  downloadApi: string;
}

interface DownloadApiConfig {
  baseURL?: string;
  listApi?: string;
  downloadApi?: string;
}

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data: T;
}

const normalizePath = (path: string | undefined, fallback: string) => {
  if (!path) {
    return fallback;
  }
  return path.startsWith("/") ? path : `/${path}`;
};

const runtimeConfig: RuntimeConfig = {
  baseURL: API_BASE_URL,
  listApi: API_PATHS.file.list,
  downloadApi: API_PATHS.file.download,
};

const apiClient = axios.create({
  baseURL: runtimeConfig.baseURL,
  timeout: 30000,
  // 同域 Cookie 自动携带（与上传侧 Worker credentials:'include' 一致）；
  // 跨域场景需服务端 CORS 允许 credentials，并使用下面 setDownloadAuth 注入 Bearer 头。
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export const configureDownloadApi = (config: DownloadApiConfig = {}): void => {
  runtimeConfig.baseURL =
    typeof config.baseURL === "string" ? config.baseURL : runtimeConfig.baseURL;
  runtimeConfig.listApi = normalizePath(config.listApi, runtimeConfig.listApi);
  runtimeConfig.downloadApi = normalizePath(
    config.downloadApi,
    runtimeConfig.downloadApi
  );

  apiClient.defaults.baseURL = runtimeConfig.baseURL;
};

/**
 * 注入下载请求的鉴权头。
 * - 传 `{ Authorization: "Bearer <token>" }` 即可对接 Bearer 鉴权；
 * - 同域 Cookie 场景无需调用（axios withCredentials 已自动携带）；
 * - 传 `undefined` 可清除已设置的头。
 */
export const setDownloadAuth = (
  headers: Record<string, string> | undefined
): void => {
  const common = apiClient.defaults.headers.common;
  if (!headers) {
    delete common["Authorization"];
    return;
  }
  Object.entries(headers).forEach(([key, value]) => {
    common[key] = value;
  });
};

export const getFileList = async (
  params: Record<string, unknown> = {}
): Promise<FileListResponse> => {
  try {
    const response = await apiClient.get<ApiEnvelope<FileListResponse>>(
      runtimeConfig.listApi,
      { params }
    );
    if (response.data.code === 200) {
      return response.data.data;
    }
    throw new Error(response.data.message || "获取文件列表失败");
  } catch (error) {
    console.error("获取文件列表失败:", error);
    throw error;
  }
};

export const createDownloadUrl = (fileId: string): string => {
  const path = `${runtimeConfig.downloadApi}/${fileId}`;
  if (runtimeConfig.baseURL) {
    return `${runtimeConfig.baseURL}${path}`;
  }
  return buildApiUrl(path);
};

export const getDownloadFiles = async (
  params: Record<string, unknown> = {}
): Promise<DownloadListItem[]> => {
  try {
    const { files } = await getFileList(params);
    return files.map((file) => ({
      id: file.id,
      url: createDownloadUrl(file.id),
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.fileType,
      metadata: {
        fileExt: file.fileExt,
        thumbnailUrl: file.thumbnailUrl,
        md5: file.md5,
        createdAt: file.createdAt,
      },
    }));
  } catch (error) {
    console.error("获取下载文件列表失败:", error);
    throw error;
  }
};

const api = {
  configureDownloadApi,
  getFileList,
  createDownloadUrl,
  getDownloadFiles,
};

export default api;
