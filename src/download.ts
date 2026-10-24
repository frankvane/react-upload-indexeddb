// 子路径入口：仅下载相关 API / 类型 / 组件。
// 消费方 `import { FileDownload } from "react-upload-indexeddb/download"` 时，
// 打包器只会拉取下载链路代码，不会带入上传引擎。样式仍为统一 dist/style.css。
import "./ui/ui.css";

export {
  default as FileDownload,
  default as ZustandFileDownload,
} from "./components/ZustandFileDownload";
export {
  configureDownloadApi,
  setDownloadAuth,
  type FileInfo,
  type FileListResponse,
} from "./components/ZustandFileDownload/api.client";

export {
  DownloadStatus,
  type DownloadFile,
  type DownloadStatusType,
  type ZustandFileDownloadProps,
  type DownloadConfig,
  type StorageStats,
} from "./components/ZustandFileDownload/types/download";
