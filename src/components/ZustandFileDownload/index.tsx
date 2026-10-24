import {
  BatchInfoDisplay,
  FileList,
  NetworkStatusBadge,
  StorageStats,
} from "./components";
import React, { useEffect } from "react";
import { configureDownloadApi } from "./api.client";

import { DownloadProvider } from "./context/DownloadContext";
import { Space } from "../../ui";
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
        {config.showBatchInfo && <BatchInfoDisplay />}
        <FileList onRefreshFiles={fetchFileList} />
      </Space>
    </div>
  );
};

const ZustandFileDownload: React.FC<ZustandFileDownloadProps> = (props) => {
  const { getStorageUsage } = useStorageManager();
  const setAutoStart = useDownloadStore((state) => state.setAutoStart);
  const setShowProgress = useDownloadStore((state) => state.setShowProgress);
  const setShowStorageStats = useDownloadStore(
    (state) => state.setShowStorageStats
  );
  const setShowNetworkStatus = useDownloadStore(
    (state) => state.setShowNetworkStatus
  );
  const setShowBatchInfo = useDownloadStore((state) => state.setShowBatchInfo);

  useNetworkDetection();

  // UI/行为类 props 同步进 store：生效优先级是 Store > Context，
  // 不同步的话消费方传入的 autoStart/showProgress/showStorageStats/
  // showNetworkStatus/showBatchInfo 会被 store 默认值（true/false）永远覆盖（props 形同虚设）。
  // 仅在显式传入时同步，未传的保持 store 现值（运行时修改不被重置）。
  useEffect(() => {
    if (props.autoStart !== undefined) setAutoStart(props.autoStart);
    if (props.showProgress !== undefined) setShowProgress(props.showProgress);
    if (props.showStorageStats !== undefined)
      setShowStorageStats(props.showStorageStats);
    if (props.showNetworkStatus !== undefined)
      setShowNetworkStatus(props.showNetworkStatus);
    if (props.showBatchInfo !== undefined) setShowBatchInfo(props.showBatchInfo);
  }, [
    props.autoStart,
    props.showProgress,
    props.showStorageStats,
    props.showNetworkStatus,
    props.showBatchInfo,
    setAutoStart,
    setShowProgress,
    setShowStorageStats,
    setShowNetworkStatus,
    setShowBatchInfo,
  ]);

  useEffect(() => {
    configureDownloadApi({
      // 缺省 / 空字符串均视为"不修改"，保留消费方此前的配置
      baseURL: props.baseURL,
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
