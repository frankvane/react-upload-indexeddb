// 子路径入口：仅上传相关 API / 类型 / 组件。
// 消费方 `import { FileUpload } from "react-upload-indexeddb/upload"` 时，
// 打包器只会拉取上传链路代码，不会带入下载引擎。样式仍为统一 dist/style.css。
import "./ui/ui.css";

export {
  default as FileUpload,
  default as ZustandFileUpload,
} from "./components/ZustandFileUpload";
export { resolveAuthHeaders } from "./components/ZustandFileUpload/utils/auth";

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
