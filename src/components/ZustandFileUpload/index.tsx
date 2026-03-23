import {
  BatchInfoDisplay,
  FileTable,
  FileUploadActions,
  StorageStatsDrawer,
} from "./components";
import React, { useEffect, useMemo, useRef } from "react";
import {
  useBatchUploader,
  useFileOperations,
  useFileProcessor,
  useNetworkDetection,
} from "./hooks";

import localforage from "localforage";
import {
  recoverInterruptedUploadFiles,
} from "./services/uploadStorage";
import { useUploadStore } from "./store/upload";
import { UploadProvider } from "./context/UploadContext";
import { useUploadContext } from "./context/useUploadContext";
import { ZustandFileUploadProps } from "./types/upload";
import { useShallow } from "zustand/react/shallow";

localforage.config({
  name: "upload-indexeddb",
  storeName: "upload_files",
});

const ZustandFileUploadCore: React.FC = () => {
  const { refreshFiles, initSettings, setConfig } = useUploadStore(
    useShallow((state) => ({
      refreshFiles: state.refreshFiles,
      initSettings: state.initSettings,
      setConfig: state.setConfig,
    }))
  );
  const batchUploader = useBatchUploader();
  const uploadAllRef = useRef(batchUploader.uploadAll);
  const fileOperations = useFileOperations(batchUploader);
  const { handleFileChange } = useFileProcessor({
    uploadAll: batchUploader.uploadAll,
  });

  const uploadConfig = useUploadContext();
  const allowedFileTypesKey = uploadConfig.allowedFileTypes.join("|");
  const normalizedAllowedFileTypes = useMemo(
    () => (allowedFileTypesKey ? allowedFileTypesKey.split("|") : []),
    [allowedFileTypesKey]
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const hasRecoveredOnceRef = useRef(false);

  useNetworkDetection();

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
      allowedFileTypes: normalizedAllowedFileTypes,
      maxFiles: uploadConfig.maxFiles,
    });
  }, [
    setConfig,
    uploadConfig.baseURL,
    uploadConfig.uploadApi,
    uploadConfig.checkApi,
    uploadConfig.chunkSize,
    uploadConfig.fileConcurrency,
    uploadConfig.chunkConcurrency,
    uploadConfig.maxRetries,
    uploadConfig.maxFileSize,
    normalizedAllowedFileTypes,
    uploadConfig.maxFiles,
  ]);

  useEffect(() => {
    uploadAllRef.current = batchUploader.uploadAll;
  }, [batchUploader.uploadAll]);

  useEffect(() => {
    initSettings({
      autoUpload: uploadConfig.autoUpload,
      autoCleanup: uploadConfig.autoCleanup,
      cleanupDelay: uploadConfig.cleanupDelay,
      networkDisplayMode: uploadConfig.networkDisplayMode,
      settingsSource: uploadConfig.settingsSource,
    });

    if (hasRecoveredOnceRef.current) {
      return;
    }
    hasRecoveredOnceRef.current = true;

    let disposed = false;

    const recoverInterruptedUploads = async () => {
      const recovery = await recoverInterruptedUploadFiles();
      await refreshFiles();

      if (disposed || recovery.totalInterrupted === 0) {
        return;
      }

      const messageApi = useUploadStore.getState().getMessageApi();

      if (recovery.recoveredCount > 0) {
        messageApi.info(
          `检测到 ${recovery.recoveredCount} 个中断上传任务，已恢复为待上传`
        );
      }

      if (recovery.missingBufferCount > 0) {
        messageApi.warning(
          `${recovery.missingBufferCount} 个文件缓存缺失，需重新选择后上传`
        );
      }

      const shouldAutoResume =
        uploadConfig.autoUpload &&
        !useUploadStore.getState().isNetworkOffline &&
        recovery.recoveredCount > 0;

      if (shouldAutoResume) {
        messageApi.info("检测到中断上传任务，正在自动继续上传");
        void uploadAllRef.current();
      }
    };

    void recoverInterruptedUploads();

    return () => {
      disposed = true;
    };
  }, [
    initSettings,
    refreshFiles,
    uploadConfig.autoUpload,
    uploadConfig.autoCleanup,
    uploadConfig.cleanupDelay,
    uploadConfig.networkDisplayMode,
    uploadConfig.settingsSource,
  ]);

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

      <FileUploadActions
        triggerFileInput={triggerFileInput}
        batchUploader={batchUploader}
        fileOperations={fileOperations}
      />
      {uploadConfig.uiMode !== "simple" && (
        <BatchInfoDisplay batchUploader={batchUploader} />
      )}
      <FileTable fileOperations={fileOperations} />
      {uploadConfig.uiMode !== "simple" && <StorageStatsDrawer />}
    </div>
  );
};

const ZustandFileUpload: React.FC<ZustandFileUploadProps> = (props) => {
  return (
    <UploadProvider {...props}>
      <ZustandFileUploadCore />
    </UploadProvider>
  );
};

export default ZustandFileUpload;
