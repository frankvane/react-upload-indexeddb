import {
  BatchInfoDisplay,
  FileTable,
  FileUploadActions,
  StorageStatsDrawer,
} from "./components";
import React, { useEffect, useRef } from "react";
import {
  useBatchUploader,
  useFileOperations,
  useFileProcessor,
  useNetworkDetection,
} from "./hooks";

import localforage from "localforage";
import { useUploadStore } from "./store/upload";
import { UploadProvider, useUploadContext } from "./context/UploadContext";
import { ZustandFileUploadProps } from "./types/upload";

// 配置localforage
localforage.config({
  name: "upload-indexeddb",
  storeName: "upload_files",
});

// 内部组件，包含实际的上传逻辑
const ZustandFileUploadCore: React.FC = () => {
  const { refreshFiles, initSettings, setConfig } = useUploadStore();
  const { handleFileChange } = useFileProcessor();
  const {
    uploadAll,
    cancelUpload,
    clearBatchInfo,
    retryUploadFile,
    retryAllFailedFiles,
  } = useBatchUploader();
  const {
    handleDeleteFile,
    handleRetryUpload,
    handleClearList,
    handleRetryAllUpload,
  } = useFileOperations();

  // 获取上传配置
  const uploadConfig = useUploadContext();

  const inputRef = useRef<HTMLInputElement>(null);

  // 使用网络状态检测钩子
  useNetworkDetection();

  // 初始化配置到 store
  useEffect(() => {
    setConfig({
      baseURL: uploadConfig.baseURL,
      uploadApi: uploadConfig.uploadApi,
      checkApi: uploadConfig.checkApi,
      chunkSize: uploadConfig.chunkSize,
      fileConcurrency: uploadConfig.fileConcurrency,
      chunkConcurrency: uploadConfig.chunkConcurrency,
      maxRetries: uploadConfig.maxRetries,
      maxFileSize: uploadConfig.maxFileSize,
      allowedFileTypes: uploadConfig.allowedFileTypes,
      maxFiles: uploadConfig.maxFiles,
    });
  }, [setConfig, uploadConfig]);

  // 初始化设置和加载文件
  useEffect(() => {
    initSettings();
    refreshFiles();
  }, [initSettings, refreshFiles]);

  // 将钩子方法注入到store中
  useEffect(() => {
    const store = useUploadStore.getState();
    store.uploadAll = uploadAll;
    store.cancelUpload = cancelUpload;
    store.clearBatchInfo = clearBatchInfo;
    store.retryUploadFile = retryUploadFile;
    store.retryAllFailedFiles = retryAllFailedFiles;
    store.handleFileChange = handleFileChange;
    store.handleDeleteFile = handleDeleteFile;
    store.handleRetryUpload = handleRetryUpload;
    store.handleClearList = handleClearList;
    store.handleRetryAllUpload = handleRetryAllUpload;
  }, [
    uploadAll,
    cancelUpload,
    clearBatchInfo,
    retryUploadFile,
    retryAllFailedFiles,
    handleFileChange,
    handleDeleteFile,
    handleRetryUpload,
    handleClearList,
    handleRetryAllUpload,
  ]);

  // 触发文件选择
  const triggerFileInput = () => {
    inputRef.current?.click();
  };

  return (
    <div>
      <input
        type="file"
        ref={inputRef}
        onChange={handleFileChange}
        multiple
        style={{ display: "none" }}
      />

      <FileUploadActions triggerFileInput={triggerFileInput} />

      <BatchInfoDisplay />
      <FileTable />
      <StorageStatsDrawer />
    </div>
  );
};

// 主组件，提供配置和 Context
const ZustandFileUpload: React.FC<ZustandFileUploadProps> = (props) => {
  return (
    <UploadProvider {...props}>
      <ZustandFileUploadCore />
    </UploadProvider>
  );
};

export default ZustandFileUpload;
