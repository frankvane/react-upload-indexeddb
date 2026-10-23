// 公共入口：供 npm 消费方导入。仅导出组件、类型与少量工具，不引入任何全局 CSS。
export { default } from "./components/ZustandFileUpload";
export { default as FileUpload, default as ZustandFileUpload } from "./components/ZustandFileUpload";
export { default as FileDownload, default as ZustandFileDownload } from "./components/ZustandFileDownload";

export { configureDownloadApi, setDownloadAuth, type FileInfo, type FileListResponse } from "./components/ZustandFileDownload/api.client";

export {
  UploadStatus,
  statusMap,
  type UploadFile,
  type UploadUIMode,
  type UploadSettingsSource,
  type ZustandFileUploadProps,
  type UploadConfig,
  type UploadAuthConfig,
  type BatchInfo,
  type ProcessProgress,
  type AlignItem,
} from "./components/ZustandFileUpload/types/upload";

export { resolveAuthHeaders } from "./components/ZustandFileUpload/utils/auth";
