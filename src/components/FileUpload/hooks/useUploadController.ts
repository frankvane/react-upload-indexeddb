import { useCallback, useRef } from "react";

import { MessageInstance } from "antd/es/message/interface";

interface UseUploadControllerOptions {
  uploadAll: () => Promise<boolean>;
  clearUploadedFiles: () => Promise<boolean>;
  messageApi: MessageInstance;
}

export const useUploadController = ({
  uploadAll,
  clearUploadedFiles,
  messageApi,
}: UseUploadControllerOptions) => {
  // 使用useRef存储函数引用，避免循环依赖
  const clearUploadedFilesRef = useRef<() => Promise<boolean>>(
    async () => false
  );
  const uploadAllRef = useRef<() => Promise<boolean>>(async () => false);

  // 封装上传函数，添加完成后的处理逻辑
  const handleUploadAll = useCallback(async () => {
    try {
      // 调用原始的uploadAll函数
      const result = await uploadAll();

      // 在短暂延迟后清理已上传文件和批次信息
      setTimeout(async () => {
        await clearUploadedFilesRef.current();
      }, 3000);

      return result;
    } catch (error) {
      console.error("上传失败:", error);
      messageApi.error(
        `上传失败: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }, [uploadAll, messageApi]);

  // 更新ref
  clearUploadedFilesRef.current = clearUploadedFiles;
  uploadAllRef.current = handleUploadAll;

  return {
    uploadAllRef,
    clearUploadedFilesRef,
    handleUploadAll,
  };
};
