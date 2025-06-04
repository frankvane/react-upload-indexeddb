import { UploadFile } from "../types/upload";
import localforage from "localforage";
import { useState } from "react";
import { useUploadStore } from "../store/upload";

export function useFileOperations() {
  const [retryingFiles, setRetryingFiles] = useState<Record<string, boolean>>(
    {}
  );
  const [isRetryingAll, setIsRetryingAll] = useState(false);

  const {
    refreshFiles,
    retryUploadFile,
    retryAllFailedFiles,
    getMessageApi,
    setRetryingFiles: setStoreRetryingFiles,
    setIsRetryingAll: setStoreIsRetryingAll,
  } = useUploadStore();

  const messageApi = getMessageApi();

  // 删除文件
  const handleDeleteFile = async (id: string): Promise<void> => {
    try {
      await localforage.removeItem(id);
      await refreshFiles();
      messageApi.success("文件已删除");
    } catch {
      messageApi.error("删除文件失败");
    }
  };

  // 重试上传单个文件
  const handleRetryUpload = async (file: UploadFile): Promise<void> => {
    // 更新重试状态
    setRetryingFiles((prev) => ({ ...prev, [file.id]: true }));
    setStoreRetryingFiles({ ...retryingFiles, [file.id]: true });

    try {
      const result = await retryUploadFile(file);
      if (result.success) {
        messageApi.success(result.message);
      } else {
        messageApi.error(result.message);
      }
    } finally {
      // 无论成功失败，都清除重试状态
      setRetryingFiles((prev) => {
        const updated = { ...prev };
        delete updated[file.id];
        return updated;
      });

      const updatedRetryingFiles = { ...retryingFiles };
      delete updatedRetryingFiles[file.id];
      setStoreRetryingFiles(updatedRetryingFiles);
    }
  };

  // 清空文件列表
  const handleClearList = async (): Promise<boolean> => {
    try {
      // 获取所有文件ID
      const keys = await localforage.keys();

      // 删除所有文件
      for (const key of keys) {
        await localforage.removeItem(key);
      }

      await refreshFiles();
      messageApi.success("文件列表已清空");
      return true;
    } catch {
      messageApi.error("清空文件列表失败");
      return false;
    }
  };

  // 批量重试上传
  const handleRetryAllUpload = async (): Promise<{
    success: boolean;
    message: string;
    retriedCount: number;
  }> => {
    setIsRetryingAll(true);
    setStoreIsRetryingAll(true);

    try {
      const result = await retryAllFailedFiles();

      if (result.success) {
        messageApi.success(result.message);
      } else {
        messageApi.error(result.message);
      }

      return result;
    } finally {
      setIsRetryingAll(false);
      setStoreIsRetryingAll(false);
    }
  };

  // 清除已上传的文件
  const handleClearUploadedFiles = async (): Promise<boolean> => {
    try {
      // 获取所有文件
      const keys = await localforage.keys();
      let count = 0;

      for (const key of keys) {
        const file = await localforage.getItem<UploadFile>(key);
        if (file && (file.status === "done" || file.status === "instant")) {
          await localforage.removeItem(key);
          count++;
        }
      }

      await refreshFiles();
      messageApi.success(`已清除 ${count} 个已上传文件`);
      return true;
    } catch {
      messageApi.error("清除已上传文件失败");
      return false;
    }
  };

  return {
    retryingFiles,
    isRetryingAll,
    handleDeleteFile,
    handleRetryUpload,
    handleClearList,
    handleRetryAllUpload,
    handleClearUploadedFiles,
  };
}
