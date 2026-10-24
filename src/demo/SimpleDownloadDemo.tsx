import React from "react";
import ZustandFileDownload from "../components/ZustandFileDownload";
import { API_BASE_URL, API_PATHS } from "../config/api";

/**
 * demo 专用：纯属性演示下载组件的精简外观。
 * 仅关闭存储统计、网络状态与批次汇总条，底层引擎与完整版完全一致。
 */
const SimpleDownloadDemo: React.FC = () => (
  <ZustandFileDownload
    baseURL={API_BASE_URL}
    listApi={API_PATHS.file.list}
    downloadApi={API_PATHS.file.download}
    autoStart={false}
    showProgress={true}
    showStorageStats={false}
    showNetworkStatus={false}
    showBatchInfo={false}
  />
);

export default SimpleDownloadDemo;
