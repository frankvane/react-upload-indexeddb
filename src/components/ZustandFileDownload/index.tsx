import {
  BatchInfoDisplay,
  FileList,
  NetworkStatusBadge,
  StorageStats,
} from "./components";
import React, { useEffect } from "react";
import { configureDownloadApi } from "./api.client";

import { DownloadProvider } from "./context/DownloadContext";
import { Space } from "antd";
import { ZustandFileDownloadProps } from "./types/download";
import { initializeStorage } from "./utils/storage";
import { useDownloadStore } from "./store";
import { useDownloadFiles } from "./hooks/useDownloadFiles";
import { useEffectiveDownloadConfig } from "./hooks/useEffectiveConfig";
import { useNetworkDetection } from "./hooks/useNetworkDetection";
import { useStorageManager } from "./hooks";
import { useShallow } from "zustand/react/shallow";

const InnerDownloadComponent: React.FC = () => {
  const config = useEffectiveDownloadConfig();
  const { isNetworkOffline } = useDownloadStore(
    useShallow((state) => ({
      isNetworkOffline: state.isNetworkOffline,
    }))
  );
  const { fetchFileList } = useDownloadFiles();

  return (
    <div style={{ padding: "20px" }}>
      <center>
        <h2>大文件下载</h2>
      </center>
      <Space direction="vertical" style={{ width: "100%" }}>
        {config.showStorageStats && <StorageStats />}
        {config.showNetworkStatus && (
          <NetworkStatusBadge
            isOffline={isNetworkOffline}
            onRefreshFiles={fetchFileList}
          />
        )}
        <BatchInfoDisplay />
        <FileList onRefreshFiles={fetchFileList} />
      </Space>
    </div>
  );
};

const ZustandFileDownload: React.FC<ZustandFileDownloadProps> = (props) => {
  const { getStorageUsage } = useStorageManager();

  useNetworkDetection();

  useEffect(() => {
    configureDownloadApi({
      baseURL: props.baseURL ?? "",
      listApi: props.listApi,
      downloadApi: props.downloadApi,
    });
  }, [props.baseURL, props.downloadApi, props.listApi]);

  useEffect(() => {
    const initStorage = async () => {
      try {
        await initializeStorage();
        await getStorageUsage();
      } catch {
        // ignored
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
