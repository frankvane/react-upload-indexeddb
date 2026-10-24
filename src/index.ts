// 公共入口：供 npm 消费方导入。
// ui.css 经此处引入，Vite lib 构建会产出 dist/style.css（消费方按需引入）：
//   import "react-upload-indexeddb/dist/style.css";
import "./ui/ui.css";

export { default } from "./components/ZustandFileUpload";
export { default as FileUpload, default as ZustandFileUpload } from "./components/ZustandFileUpload";
export { default as FileDownload, default as ZustandFileDownload } from "./components/ZustandFileDownload";

// 简化版组件（轻量默认外观，底层仍是完整分片续传引擎）
export { default as SimpleUploadList } from "./components/SimpleUploadList";
export type {
  SimpleUploadListProps,
  SimpleServerFile,
} from "./components/SimpleUploadList";
export {
  default as SimpleDownloadList,
  type SimpleDownloadListProps,
} from "./components/SimpleDownloadList";

export { configureDownloadApi, setDownloadAuth, type FileInfo, type FileListResponse } from "./components/ZustandFileDownload/api.client";

export {
  UploadStatus,
  statusMap,
  type UploadFile,
  type UploadUIMode,
  type UploadSettingsSource,
  type ZustandFileUploadProps,
  type UploadColumnKey,
  type UploadConfig,
  type UploadAuthConfig,
  type BatchInfo,
  type ProcessProgress,
  type AlignItem,
} from "./components/ZustandFileUpload/types/upload";

export {
  type ZustandFileDownloadProps,
  type DownloadColumnKey,
  type DownloadFile,
  type DownloadStatus,
} from "./components/ZustandFileDownload/types/download";

export { resolveAuthHeaders } from "./components/ZustandFileUpload/utils/auth";

// 调试日志开关：库默认静默，消费方排查时调用 configureDebug({ silent: false }) 打开。
export { configureDebug } from "./shared/debugLogger";

// UI 套件类型：消费方实现 setMessageApi 注入时需要 MessageInstance 签名
export type { MessageInstance } from "./ui";
