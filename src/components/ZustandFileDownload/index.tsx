import { Card, ConfigProvider, message } from "antd";
import { DownloadStatus, ZustandFileDownloadProps } from "./types/download";
import React, { useEffect } from "react";

import api from "./api.client";
import { useDownloadStore } from "./store/download";
import useFileDownloader from "./hooks/useFileDownloader";

/**
 * ZustandFileDownload 组件
 *
 * 一个基于React和Zustand的超大文件下载组件，支持2GB以上文件的高效下载、断点续传和分片管理。
 */
const ZustandFileDownload: React.FC<ZustandFileDownloadProps> = ({
  config,
  onComplete,
  onError,
  onProgress,
  className = "",
  style = {},
  showUI = true,
  showFileList = false,
  autoLoadFiles = false,
}) => {
  const {
    updateConfig,
    setMessageApi,
    totalProgress,
    downloadTasks,
    refreshTasks,
  } = useDownloadStore();

  const { downloadFiles } = useFileDownloader();

  // 初始化消息API
  useEffect(() => {
    setMessageApi(message);
  }, [setMessageApi]);

  // 初始化配置
  useEffect(() => {
    if (config) {
      updateConfig(config);
    }
  }, [config, updateConfig]);

  // 自动加载下载资源列表
  useEffect(() => {
    if (autoLoadFiles) {
      const loadDownloadFiles = async () => {
        try {
          // 获取可下载文件列表
          const files = await api.getDownloadFiles();

          if (files && files.length > 0) {
            console.log(`已加载 ${files.length} 个可下载文件`);
            // 可以选择自动添加到下载队列，但默认不执行下载
            // 如果需要自动下载，可以取消下面注释
            // await downloadFiles(files);
          }
        } catch (error) {
          console.error("自动加载下载资源失败:", error);
          if (onError) {
            onError(error instanceof Error ? error : new Error(String(error)));
          }
        }
      };

      loadDownloadFiles();
    }
  }, [autoLoadFiles, downloadFiles, onError]);

  // 监听进度变化
  useEffect(() => {
    if (onProgress) {
      onProgress(totalProgress);
    }
  }, [totalProgress, onProgress]);

  // 监听任务完成
  useEffect(() => {
    if (onComplete) {
      const checkCompletedTasks = async () => {
        try {
          const tasks = await refreshTasks();
          const newlyCompletedTasks = tasks.filter(
            (task) =>
              task.status === DownloadStatus.COMPLETED &&
              task.completedAt &&
              Date.now() - task.completedAt < 1000 // 最近1秒内完成的
          );

          newlyCompletedTasks.forEach((task) => {
            onComplete?.(task);
          });
        } catch (err) {
          // 处理错误
          const error = err instanceof Error ? err : new Error(String(err));
          console.error("Error checking completed tasks:", error);
          onError?.(error);
        }
      };

      checkCompletedTasks();
    }
  }, [downloadTasks, onComplete, refreshTasks, onError]);

  // 全局错误处理
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error("Global error in ZustandFileDownload:", event.error);
      if (onError) {
        onError(event.error);
      }
    };

    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, [onError]);

  // 如果不显示UI，只返回一个空的div
  if (!showUI) {
    return <div className="zustand-file-download-container" />;
  }

  // 动态导入组件，避免模块导入问题
  const DownloadActions = React.lazy(
    () => import("./components/DownloadActions")
  );
  const DownloadInfoDisplay = React.lazy(
    () => import("./components/DownloadInfoDisplay")
  );
  const DownloadTable = React.lazy(() => import("./components/DownloadTable"));
  const StorageStatsDrawer = React.lazy(
    () => import("./components/StorageStatsDrawer")
  );
  const FileListPanel = React.lazy(() => import("./components/FileListPanel"));

  return (
    <ConfigProvider>
      <div
        className={`zustand-file-download-container ${className}`}
        style={{
          width: "100%",
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "16px",
          ...style,
        }}
      >
        {showFileList && (
          <React.Suspense fallback={<div>加载中...</div>}>
            <FileListPanel refreshInterval={30000} />
          </React.Suspense>
        )}

        <Card
          title="文件下载管理器"
          variant="outlined"
          className="download-manager-card"
          style={{ marginTop: showFileList ? 16 : 0 }}
        >
          <React.Suspense fallback={<div>加载中...</div>}>
            <DownloadActions />
            <DownloadInfoDisplay />
            <DownloadTable />
            <StorageStatsDrawer />
          </React.Suspense>
        </Card>
      </div>
    </ConfigProvider>
  );
};

// 导出组件和相关钩子
export default ZustandFileDownload;

// 直接导出，忽略类型错误
export { useDownloadStore } from "./store/download";
export { default as useBatchDownloader } from "./hooks/useBatchDownloader";
export { default as useFileDownloader } from "./hooks/useFileDownloader";
export { default as useNetworkDetection } from "./hooks/useNetworkDetection";
export { default as useResumeSupport } from "./hooks/useResumeSupport";
export { default as useStorageReporter } from "./hooks/useStorageReporter";
export { default as useAutoDownload } from "./hooks/useAutoDownload";

// 导出所有类型
export * from "./types/download";
