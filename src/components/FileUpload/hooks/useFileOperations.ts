import { MessageInstance } from "antd/es/message/interface";
import { UploadFile } from "../types/upload";
import localforage from "localforage";
import { useState } from "react";

interface UseFileOperationsOptions {
  refreshFiles: () => Promise<void>;
  retryUploadFile: (
    file: UploadFile
  ) => Promise<{ success: boolean; message?: string }>;
  retryAllFailedFiles: () => Promise<{
    success: boolean;
    message: string;
    retriedCount: number;
  }>;
  messageApi: MessageInstance;
}

export const useFileOperations = ({
  refreshFiles,
  retryUploadFile,
  retryAllFailedFiles,
  messageApi,
}: UseFileOperationsOptions) => {
  const [retryingFiles, setRetryingFiles] = useState<Record<string, boolean>>(
    {}
  );
  const [isRetryingAll, setIsRetryingAll] = useState(false);

  const handleDeleteFile = async (id: string) => {
    await localforage.removeItem(id);
    await refreshFiles();
  };

  const handleRetryUpload = async (file: UploadFile) => {
    try {
      // 设置该文件为重试中状态
      setRetryingFiles((prev) => ({ ...prev, [file.id]: true }));

      const result = await retryUploadFile(file);

      if (result.success) {
        // 重试成功，显示提示消息
        messageApi.success(
          result.message || `文件 ${file.fileName} 重试上传成功`
        );
      } else {
        messageApi.error(
          result.message || `文件 ${file.fileName} 重试上传失败`
        );
      }
    } catch (error) {
      console.error("重试上传失败:", error);
      messageApi.error(
        `上传出错: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // 清除重试状态
      setRetryingFiles((prev) => {
        const updated = { ...prev };
        delete updated[file.id];
        return updated;
      });
    }
  };

  const handleClearList = async () => {
    try {
      // 清空IndexedDB存储
      await localforage.clear();
      // 刷新文件列表
      await refreshFiles();
      return true;
    } catch (error) {
      console.error("清空文件列表失败:", error);
      messageApi.error(
        `清空文件列表失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  };

  // 批量重试所有失败的文件
  const handleRetryAllUpload = async () => {
    try {
      setIsRetryingAll(true);
      const result = await retryAllFailedFiles();

      if (result.retriedCount === 0) {
        messageApi.info(result.message);
      } else if (result.success) {
        messageApi.success(result.message);
      } else {
        messageApi.error(result.message);
      }

      return result;
    } catch (error) {
      console.error("批量重试失败:", error);
      messageApi.error(
        `批量重试出错: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return { success: false, message: "批量重试出错", retriedCount: 0 };
    } finally {
      setIsRetryingAll(false);
    }
  };

  return {
    retryingFiles,
    isRetryingAll,
    handleDeleteFile,
    handleRetryUpload,
    handleClearList,
    handleRetryAllUpload,
  };
};
