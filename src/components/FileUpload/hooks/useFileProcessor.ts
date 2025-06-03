import { useRef, useState } from "react";

import { MessageInstance } from "antd/es/message/interface";
import localforage from "localforage";
import { useNetworkType } from "./useNetworkType";

interface ProcessProgress {
  processed: number;
  total: number;
  success: number;
  failed: number;
  oversized: number;
}

interface UseFileProcessorOptions {
  autoUpload: boolean;
  isNetworkOffline: boolean;
  refreshFiles: () => Promise<void>;
  uploadAllRef: React.MutableRefObject<() => Promise<boolean>>;
  messageApi: MessageInstance;
}

export const useFileProcessor = ({
  autoUpload,
  isNetworkOffline,
  refreshFiles,
  uploadAllRef,
  messageApi,
}: UseFileProcessorOptions) => {
  const [loading, setLoading] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [processProgress, setProcessProgress] =
    useState<ProcessProgress | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 使用网络类型钩子获取动态参数
  const { networkType, fileConcurrency, chunkConcurrency, chunkSize } =
    useNetworkType();

  // 获取文件准备worker的url
  const filePrepareWorkerUrl = new URL(
    "../worker/filePrepareWorker.ts",
    import.meta.url
  ).href;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    setCost(null);
    const start = Date.now();

    // 初始化处理进度
    setProcessProgress({
      processed: 0,
      total: files.length,
      success: 0,
      failed: 0,
      oversized: 0,
    });

    // 创建文件准备worker
    const worker = new Worker(filePrepareWorkerUrl);

    // 将网络参数传递给worker
    worker.postMessage({
      files,
      networkParams: {
        chunkSize,
        chunkConcurrency,
        fileConcurrency,
        networkType,
      },
    });

    // 处理worker消息
    worker.onmessage = async (event) => {
      const data = event.data;

      if (data.type === "progress") {
        // 处理进度更新
        setProcessProgress({
          processed: data.processed,
          total: data.total,
          success: data.success,
          failed: data.failed,
          oversized: data.oversized,
        });
      } else if (data.type === "complete") {
        // 处理完成
        const { uploadFiles } = data;
        for (const uploadFile of uploadFiles) {
          await localforage.setItem(uploadFile.id, uploadFile);
        }
        await refreshFiles();
        const end = Date.now();
        setCost(end - start);
        setLoading(false);

        // 显示处理完成消息
        if (uploadFiles.length > 0) {
          messageApi.success(`成功处理 ${uploadFiles.length} 个文件`);
        }

        setTimeout(() => {
          setCost(null);
          setProcessProgress(null);
        }, 3000);

        // 根据autoUpload设置决定是否自动上传
        if (autoUpload && uploadFiles.length > 0 && !isNetworkOffline) {
          uploadAllRef.current();
        }
      }
    };
  };

  const triggerFileInput = () => {
    inputRef.current?.click();
  };

  return {
    loading,
    cost,
    processProgress,
    handleFileChange,
    inputRef,
    triggerFileInput,
  };
};
