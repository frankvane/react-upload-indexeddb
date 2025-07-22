import {
  BatchInfoDisplay,
  FileList,
  NetworkStatusBadge,
  StorageStats,
} from "./components";
import React, { useEffect } from "react";

import { DownloadProvider } from "./context/DownloadContext";
import { Space } from "antd";
import { ZustandFileDownloadProps } from "./types/download";
import { initializeStorage } from "./utils/storage";
import { useDownloadStore } from "./store";
import { useEffectiveDownloadConfig } from "./hooks/useEffectiveConfig";
import { useNetworkDetection } from "./hooks/useNetworkDetection";
import { useStorageManager } from "./hooks";

/**
 * 内部组件 - 在 Provider 内部使用配置
 */
const InnerDownloadComponent: React.FC = () => {
  const config = useEffectiveDownloadConfig();
  const { isNetworkOffline } = useDownloadStore();

  return (
    <div style={{ padding: "20px" }}>
      <center>
        <h2>大文件下载</h2>
      </center>
      <Space direction="vertical" style={{ width: "100%" }}>
        {config.showStorageStats && <StorageStats />}
        {config.showNetworkStatus && (
          <NetworkStatusBadge isOffline={isNetworkOffline} />
        )}
        <BatchInfoDisplay />
        <FileList />
      </Space>
    </div>
  );
};

/**
 * ZustandFileDownload组件
 * 使用Zustand进行状态管理的大文件下载组件
 */
const ZustandFileDownload: React.FC<ZustandFileDownloadProps> = (props) => {
  // 只获取初始化所需的方法
  const { getStorageUsage } = useStorageManager();

  // 使用网络检测钩子
  useNetworkDetection();

  // 初始化存储
  useEffect(() => {
    const initStorage = async () => {
      try {
        await initializeStorage();
        // 初始化后获取存储使用情况
        await getStorageUsage();
      } catch {
        // 初始化存储失败
      }
    };

    initStorage();
  }, [getStorageUsage]);

  return (
    <DownloadProvider {...props}>
      <InnerDownloadComponent />
    </DownloadProvider>
  );
};

export default ZustandFileDownload;
