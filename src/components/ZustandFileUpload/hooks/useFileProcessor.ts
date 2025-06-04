import localforage from "localforage";
import { useUploadStore } from "../store/upload";

// 导入Worker
const FilePrepareWorker = new Worker(
  new URL("../worker/filePrepareWorker.ts", import.meta.url),
  { type: "module" }
);

export function useFileProcessor() {
  const {
    autoUpload,
    isNetworkOffline,
    networkType,
    fileConcurrency,
    chunkConcurrency,
    chunkSize,
    refreshFiles,
    setProcessProgress,
    setLoading,
    setCost,
    uploadAll,
    getMessageApi,
  } = useUploadStore();

  const messageApi = getMessageApi();

  // 处理文件选择
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const files = Array.from(e.target.files);
    e.target.value = ""; // 清空输入，以便重新选择相同文件

    // 如果网络离线，不允许上传
    if (isNetworkOffline) {
      messageApi.error("网络已断开，无法上传文件");
      return;
    }

    setLoading(true);
    const startTime = Date.now();

    // 启动Worker处理文件
    FilePrepareWorker.postMessage({
      files,
      networkParams: {
        networkType,
        fileConcurrency,
        chunkConcurrency,
        chunkSize,
      },
    });

    // 监听Worker消息
    const handleWorkerMessage = async (event: MessageEvent) => {
      const {
        type,
        processed,
        total,
        success,
        failed,
        oversized,
        uploadFiles,
        stats,
      } = event.data;

      if (type === "progress") {
        // 更新处理进度
        setProcessProgress({
          processed,
          total,
          success,
          failed,
          oversized,
        });
      } else if (type === "complete") {
        // 处理完成
        setProcessProgress(null);
        setLoading(false);

        // 计算处理耗时
        const endTime = Date.now();
        const cost = endTime - startTime;
        setCost(cost);

        // 保存文件到IndexedDB
        for (const file of uploadFiles) {
          await localforage.setItem(file.id, file);
        }

        // 刷新文件列表
        await refreshFiles();

        // 显示处理结果
        const resultMessage = `处理完成: ${stats.success}个成功, ${
          stats.failed
        }个失败${
          stats.oversized > 0 ? `, ${stats.oversized}个超过大小限制` : ""
        }`;
        messageApi.success(resultMessage);

        // 如果启用了自动上传，立即开始上传
        if (autoUpload && stats.success > 0 && !isNetworkOffline) {
          setTimeout(() => {
            uploadAll();
          }, 500);
        }

        // 移除事件监听器
        FilePrepareWorker.removeEventListener("message", handleWorkerMessage);
      }
    };

    FilePrepareWorker.addEventListener("message", handleWorkerMessage);
  };

  return {
    handleFileChange,
  };
}
