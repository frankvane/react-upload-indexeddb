import localforage from "localforage";
import { useRef } from "react";
import { useUploadStore } from "../store/upload";
import { useUploadContext } from "../context/UploadContext";

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
    setFileTimings,
    uploadAll,
    getMessageApi,
  } = useUploadStore();

  // 获取上传配置
  const uploadConfig = useUploadContext();

  const messageApi = getMessageApi();

  // 使用ref来存储文件处理开始时间
  const fileStartTimesRef = useRef<Record<string, number>>({});

  // 文件验证函数
  const validateFiles = (files: File[]): { validFiles: File[]; errors: string[] } => {
    const validFiles: File[] = [];
    const errors: string[] = [];

    // 检查文件数量限制
    if (files.length > uploadConfig.maxFiles) {
      errors.push(`最多只能选择 ${uploadConfig.maxFiles} 个文件`);
      return { validFiles: [], errors };
    }

    files.forEach((file) => {
      // 检查文件大小
      if (file.size > uploadConfig.maxFileSize) {
        errors.push(`文件 "${file.name}" 大小超过限制 (${Math.round(uploadConfig.maxFileSize / 1024 / 1024)}MB)`);
        return;
      }

      // 检查文件类型
      if (uploadConfig.allowedFileTypes.length > 0) {
        const fileExtension = file.name.split('.').pop()?.toLowerCase();
        const mimeType = file.type.toLowerCase();

        const isAllowed = uploadConfig.allowedFileTypes.some(type => {
          if (type.startsWith('.')) {
            return fileExtension === type.slice(1).toLowerCase();
          }
          return mimeType.includes(type.toLowerCase());
        });

        if (!isAllowed) {
          errors.push(`文件 "${file.name}" 类型不被允许`);
          return;
        }
      }

      // 自定义验证
      if (uploadConfig.customFileValidator) {
        const validation = uploadConfig.customFileValidator(file);
        if (!validation.valid) {
          errors.push(validation.message || `文件 "${file.name}" 验证失败`);
          return;
        }
      }

      validFiles.push(file);
    });

    return { validFiles, errors };
  };

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

    // 验证文件
    const { validFiles, errors } = validateFiles(files);

    if (errors.length > 0) {
      errors.forEach(error => messageApi.error(error));
      if (validFiles.length === 0) return;
    }

    if (validFiles.length === 0) {
      messageApi.warning("没有有效的文件可以上传");
      return;
    }

    // 重置文件处理时间记录
    fileStartTimesRef.current = {};
    setFileTimings({});

    setLoading(true);
    const startTime = Date.now();

    // 记录每个文件的处理开始时间
    validFiles.forEach((file) => {
      fileStartTimesRef.current[file.name] = Date.now();
    });

    // 触发上传开始回调
    if (uploadConfig.onUploadStart) {
      // 这里需要转换为 UploadFile 格式，但在文件处理阶段我们还没有完整的 UploadFile 对象
      // 所以我们在后续的处理完成后再调用
    }

    // 启动Worker处理文件
    FilePrepareWorker.postMessage({
      files: validFiles,
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
        fileDetails,
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

        // 如果有文件详情，记录处理时间
        if (fileDetails && fileDetails.fileName) {
          const fileName = fileDetails.fileName;
          const startTime = fileStartTimesRef.current[fileName] || 0;
          if (startTime > 0) {
            const processingTime = Date.now() - startTime;
            setFileTimings((prev: Record<string, number>) => ({
              ...prev,
              [fileName]: processingTime,
            }));
            // 清除已处理文件的开始时间记录
            delete fileStartTimesRef.current[fileName];
          }
        }
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

          // 确保所有文件都有处理时间记录
          if (!fileStartTimesRef.current[file.fileName]) {
            setFileTimings((prev: Record<string, number>) => ({
              ...prev,
              [file.fileName]: Math.round(cost / uploadFiles.length), // 估算时间
            }));
          }
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
