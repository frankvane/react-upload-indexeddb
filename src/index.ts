// 公共入口：供 npm 消费方导入。
// ui.css 经此处引入，Vite lib 构建会产出 dist/style.css（消费方按需引入）：
//   import "react-upload-indexeddb/dist/style.css";
import "./ui/ui.css";

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

// UI 套件类型：消费方实现 setMessageApi 注入时需要 MessageInstance 签名
export type { MessageInstance } from "./ui";
