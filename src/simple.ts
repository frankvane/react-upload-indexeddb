// 子路径入口：仅两个简化版组件（轻量默认外观）。
// 注意：SimpleUploadList 内含上传引擎、SimpleDownloadList 内含下载引擎，
// 因此引入本入口会同时带入两条链路；只想用其一请改用 /upload 或 /download。
import "./ui/ui.css";

export { default as SimpleUploadList } from "./components/SimpleUploadList";
export type {
  SimpleUploadListProps,
  SimpleServerFile,
} from "./components/SimpleUploadList";
export {
  default as SimpleDownloadList,
  type SimpleDownloadListProps,
} from "./components/SimpleDownloadList";
