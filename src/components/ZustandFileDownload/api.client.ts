import axios, { type AxiosInstance } from "axios";
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
  /** 是否携带 Cookie（credentials:'include'）。默认 false（same-origin）。
   *  跨域 Bearer 头鉴权场景保持 false 即可；仅同域/跨域 Cookie 鉴权才需 true，
   *  且服务端需返回 Access-Control-Allow-Credentials:true。 */
  withCredentials?: boolean;
}

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data: T;
}

export interface DownloadApiClient {
  /** 该实例的 axios 实例（测试/调试用） */
  apiClient: AxiosInstance;
  /** 配置基础地址与接口路径（缺省保留现值，避免组件重复 mount 重置） */
  configureDownloadApi: (config?: DownloadApiConfig) => void;
  /** 注入/清除下载请求的鉴权头（如 Bearer） */
  setDownloadAuth: (headers: Record<string, string> | undefined) => void;
  getFileList: (
    params?: Record<string, unknown>
  ) => Promise<FileListResponse>;
  createDownloadUrl: (fileId: string) => string;
  getDownloadFiles: (
    params?: Record<string, unknown>
  ) => Promise<DownloadListItem[]>;
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  baseURL: API_BASE_URL,
  listApi: API_PATHS.file.list,
  downloadApi: API_PATHS.file.download,
};

const normalizePath = (path: string | undefined, fallback: string) => {
  if (!path) {
    return fallback;
  }
  return path.startsWith("/") ? path : `/${path}`;
};

/**
 * 创建每实例下载 API 客户端（T3.2 单例治理，对应下载侧 axios/runtimeConfig）。
 *
 * 此前下载侧只有模块级唯一 apiClient + 全局 runtimeConfig，多个下载组件实例
 * 会共享同一份配置互相干扰。现改为工厂：每个调用方可持有一份独立客户端
 * （独立 axios 实例 + 独立 runtimeConfig + 独立鉴权头），互不串配置。
 */
export const createDownloadApiClient = (): DownloadApiClient => {
  const runtimeConfig: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG };

  const apiClient = axios.create({
    baseURL: runtimeConfig.baseURL,
    timeout: 30000,
    // 默认不携带 Cookie（same-origin 语义）：跨域 Bearer 头鉴权时不触发 CORS 对
    // Access-Control-Allow-Credentials:true 的强校验；同域 Cookie 场景浏览器仍会
    // 自动携带。需要跨域 Cookie 鉴权时由 configureDownloadApi({ withCredentials:true }) 开启。
    withCredentials: false,
    headers: {
      "Content-Type": "application/json",
    },
  });

  const configureDownloadApi = (config: DownloadApiConfig = {}): void => {
    // baseURL 仅在显式传入非空字符串时覆盖：空字符串/缺省视为"不修改"，
    // 避免组件重复 mount（props.baseURL ?? ""）清空先前配置
    if (typeof config.baseURL === "string" && config.baseURL !== "") {
      runtimeConfig.baseURL = config.baseURL;
    }
    runtimeConfig.listApi = normalizePath(config.listApi, runtimeConfig.listApi);
    runtimeConfig.downloadApi = normalizePath(
      config.downloadApi,
      runtimeConfig.downloadApi
    );

    apiClient.defaults.baseURL = runtimeConfig.baseURL;
    // 是否携带 Cookie：缺省保留现值（避免组件重复 mount 重置先前配置）；
    // 默认 false（same-origin），仅跨域 Cookie 鉴权时显式开启
    apiClient.defaults.withCredentials =
      config.withCredentials ?? apiClient.defaults.withCredentials;
  };

  /**
   * 注入下载请求的鉴权头。
   * - 传 `{ Authorization: "Bearer <token>" }` 即可对接 Bearer 鉴权；
   * - 同域 Cookie 场景无需调用（axios withCredentials 已自动携带）；
   * - 传 `undefined` 可清除已设置的头。
   */
  const setDownloadAuth = (
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

  const getFileList = async (
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

  const createDownloadUrl = (fileId: string): string => {
    const path = `${runtimeConfig.downloadApi}/${fileId}`;
    if (runtimeConfig.baseURL) {
      return `${runtimeConfig.baseURL}${path}`;
    }
    return buildApiUrl(path);
  };

  const getDownloadFiles = async (
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

  return {
    apiClient,
    configureDownloadApi,
    setDownloadAuth,
    getFileList,
    createDownloadUrl,
    getDownloadFiles,
  };
};

/**
 * 模块级默认下载客户端（向后兼容）。
 *
 * 保持导出 `apiClient` + 各方法，使既有 `import { configureDownloadApi }`、
 * `import * as apiClient` 等用法零改动继续可用；需多实例隔离的调用方可自行
 * `createDownloadApiClient(instanceId)` 取得独立客户端。
 */
const defaultClient = createDownloadApiClient();

export const apiClient: AxiosInstance = defaultClient.apiClient;
export const configureDownloadApi = defaultClient.configureDownloadApi;
export const setDownloadAuth = defaultClient.setDownloadAuth;
export const getFileList = defaultClient.getFileList;
export const createDownloadUrl = defaultClient.createDownloadUrl;
export const getDownloadFiles = defaultClient.getDownloadFiles;

const api = {
  configureDownloadApi,
  getFileList,
  createDownloadUrl,
  getDownloadFiles,
};

export default api;
