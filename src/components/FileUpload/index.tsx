import {
  BatchInfoDisplay,
  FileTable,
  FileUploadActions,
  StorageStatsDrawer,
} from "./components";
import {
  useBatchUploader,
  useFileOperations,
  useFileProcessor,
  useIndexedDBFiles,
  useLocalStorageSettings,
  useNetworkStatusHandler,
  useNetworkType,
  useUploadController,
} from "./hooks";
import { useEffect, useState } from "react";

import { UploadStatus } from "./types/upload";
import localforage from "localforage";
import { message } from "antd";

// 配置localforage
localforage.config({
  name: "upload-indexeddb",
  storeName: "upload_files",
});

const FileUpload = () => {
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [storageStatsVisible, setStorageStatsVisible] = useState(false);
  // 创建一个全局的 messageApi
  const [messageApi, contextHolder] = message.useMessage();

  // 获取所有文件以及刷新文件列表
  const { files: allFiles, refresh: refreshFiles } = useIndexedDBFiles();

  // 使用网络类型钩子获取动态参数
  const { networkType, fileConcurrency, chunkConcurrency, chunkSize } =
    useNetworkType();

  // 检查网络是否断开
  const isNetworkOffline = networkType === "offline";

  // 使用本地存储设置
  const {
    autoUpload,
    setAutoUpload,
    networkDisplayMode,
    setNetworkDisplayMode,
  } = useLocalStorageSettings();

  // 将 fileConcurrency 传递给 useBatchUploader
  const {
    uploadAll,
    batchInfo,
    isUploading,
    cancelUpload,
    clearBatchInfo,
    retryUploadFile,
    retryAllFailedFiles,
  } = useBatchUploader({
    setProgressMap, // 设置进度映射
    fileConcurrency, // 文件并发数
    chunkConcurrency, // 分块并发数
    maxRetries: 3, // 默认重试次数
    timeout: 30000, // 默认超时时间（毫秒）
    retryInterval: 1000, // 重试间隔时间（毫秒）
    refreshFiles, // 刷新文件列表
  });

  // 定义清理函数
  const handleClearUploadedFiles = async (): Promise<boolean> => {
    try {
      // 获取所有已上传完成的文件和错误文件
      const filesToClear = allFiles.filter(
        (file) =>
          file.status === UploadStatus.DONE ||
          file.status === UploadStatus.INSTANT ||
          file.status === UploadStatus.ERROR ||
          file.status === UploadStatus.MERGE_ERROR
      );

      if (filesToClear.length === 0) {
        return true;
      }

      // 删除已上传完成和错误的文件
      for (const file of filesToClear) {
        await localforage.removeItem(file.id);
      }

      // 刷新文件列表
      await refreshFiles();
      // 重置批次信息
      await clearBatchInfo();
      // 重置进度映射
      setProgressMap({});
      // 显示成功消息
      messageApi.success(`已清除 ${filesToClear.length} 个文件`);
      return true;
    } catch (error) {
      console.error("清除文件失败:", error);
      messageApi.error(
        `清除文件失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  };

  // 使用上传控制器
  const { uploadAllRef, handleUploadAll } = useUploadController({
    uploadAll,
    clearUploadedFiles: handleClearUploadedFiles,
    messageApi, // 传递 messageApi 给 useUploadController
  });

  // 使用文件处理器
  const {
    loading,
    cost,
    processProgress,
    handleFileChange,
    inputRef,
    triggerFileInput,
  } = useFileProcessor({
    autoUpload,
    isNetworkOffline,
    refreshFiles,
    uploadAllRef,
    messageApi, // 传递 messageApi 给 useFileProcessor
  });

  // 使用文件操作
  const {
    retryingFiles,
    isRetryingAll,
    handleDeleteFile,
    handleRetryUpload,
    handleClearList,
    handleRetryAllUpload,
  } = useFileOperations({
    refreshFiles,
    retryUploadFile,
    retryAllFailedFiles,
    messageApi, // 传递 messageApi 给 useFileOperations
  });

  // 使用网络状态处理器
  useNetworkStatusHandler({
    networkType,
    isUploading,
    cancelUpload,
    uploadAll: handleUploadAll,
    retryAllFailedFiles,
    allFiles,
    messageApi, // 传递 messageApi 给 useNetworkStatusHandler
  });

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  // 处理页面刷新后的自动上传
  useEffect(() => {
    // 确保文件列表已加载且不是首次渲染
    if (
      allFiles.length > 0 &&
      autoUpload &&
      !isUploading &&
      !isNetworkOffline
    ) {
      // 检查是否有需要上传的文件
      const pendingFiles = allFiles.filter(
        (file) =>
          file.status === UploadStatus.CALCULATING ||
          file.status === UploadStatus.QUEUED ||
          file.status === UploadStatus.QUEUED_FOR_UPLOAD ||
          file.status === UploadStatus.PREPARING_UPLOAD ||
          file.status === UploadStatus.UPLOADING ||
          file.status === UploadStatus.PAUSED
      );

      if (pendingFiles.length > 0) {
        // 添加短暂延迟确保组件完全加载
        const timer = setTimeout(() => {
          uploadAllRef.current();
        }, 1000);

        return () => clearTimeout(timer);
      }
    }
  }, [allFiles, autoUpload, isUploading, isNetworkOffline, uploadAllRef]);

  // 当批次信息更新时，如果批次完成，则清除已上传文件
  useEffect(() => {
    if (!batchInfo) return;
    if (batchInfo.current === batchInfo.total) {
      const timer = setTimeout(async () => {
        await handleClearUploadedFiles();
      }, 3000);

      return () => {
        clearTimeout(timer);
      };
    }
  }, [allFiles, batchInfo]);

  // 打开存储统计抽屉
  const showStorageStats = () => {
    setStorageStatsVisible(true);
  };

  // 关闭存储统计抽屉
  const closeStorageStats = () => {
    setStorageStatsVisible(false);
  };

  // 计算错误文件数量
  const errorFilesCount = allFiles.filter(
    (file) => file.status === UploadStatus.ERROR
  ).length;

  return (
    <div>
      {/* 只保留一个 contextHolder */}
      {contextHolder}

      <input
        type="file"
        ref={inputRef}
        onChange={handleFileChange}
        multiple
        style={{ display: "none" }}
      />

      <FileUploadActions
        triggerFileInput={triggerFileInput}
        uploadAll={handleUploadAll}
        clearList={handleClearList}
        retryAllUpload={handleRetryAllUpload}
        showStorageStats={showStorageStats}
        loading={loading}
        cost={cost}
        processProgress={processProgress}
        allFilesCount={allFiles.length}
        errorFilesCount={errorFilesCount}
        isUploading={isUploading}
        isRetryingAll={isRetryingAll}
        isNetworkOffline={isNetworkOffline}
        autoUpload={autoUpload}
        setAutoUpload={setAutoUpload}
        networkType={networkType}
        chunkSize={chunkSize}
        fileConcurrency={fileConcurrency}
        chunkConcurrency={chunkConcurrency}
        networkDisplayMode={networkDisplayMode}
        setNetworkDisplayMode={setNetworkDisplayMode}
      />

      <BatchInfoDisplay
        batchInfo={batchInfo}
        isUploading={isUploading}
        cancelUpload={cancelUpload}
        clearBatchInfo={clearBatchInfo}
      />

      <FileTable
        files={allFiles}
        progressMap={progressMap}
        retryingFiles={retryingFiles}
        isUploading={isUploading}
        isNetworkOffline={isNetworkOffline}
        onDeleteFile={handleDeleteFile}
        onRetryUpload={handleRetryUpload}
      />

      {/* 存储统计抽屉 */}
      <StorageStatsDrawer
        visible={storageStatsVisible}
        onClose={closeStorageStats}
      />
    </div>
  );
};

export default FileUpload;
