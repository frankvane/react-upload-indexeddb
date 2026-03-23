import type { ChangeEvent } from "react";
import { useEffect, useRef } from "react";
import localforage from "localforage";

import { useEffectiveUploadConfig } from "./useEffectiveConfig";
import { useUploadStore } from "../store/upload";
import { ProcessingStats, UploadFile } from "../types/upload";
import { useShallow } from "zustand/react/shallow";

interface WorkerProgressMessage {
  type: "progress";
  processed: number;
  total: number;
  success: number;
  failed: number;
  oversized: number;
  fileDetails?: {
    fileName: string;
    fileSize: number;
    fileType: string;
    index: number;
    total: number;
    error?: boolean;
    errorMessage?: string;
  };
}

interface WorkerCompleteMessage {
  type: "complete";
  uploadFiles: UploadFile[];
  stats: ProcessingStats;
}

type WorkerMessage = WorkerProgressMessage | WorkerCompleteMessage;

const createFilePrepareWorker = () =>
  new Worker(new URL("../worker/filePrepareWorker.ts", import.meta.url), {
    type: "module",
  });

interface UseFileProcessorOptions {
  uploadAll: () => Promise<boolean>;
}

export function useFileProcessor({ uploadAll }: UseFileProcessorOptions) {
  const {
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
    getMessageApi,
  } = useUploadStore(
    useShallow((state) => ({
      isNetworkOffline: state.isNetworkOffline,
      networkType: state.networkType,
      fileConcurrency: state.fileConcurrency,
      chunkConcurrency: state.chunkConcurrency,
      chunkSize: state.chunkSize,
      refreshFiles: state.refreshFiles,
      setProcessProgress: state.setProcessProgress,
      setLoading: state.setLoading,
      setCost: state.setCost,
      setFileTimings: state.setFileTimings,
      getMessageApi: state.getMessageApi,
    }))
  );
  const uploadConfig = useEffectiveUploadConfig();
  const messageApi = getMessageApi();

  const fileStartTimesRef = useRef<Record<string, number>>({});
  const prepareWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      const worker = prepareWorkerRef.current;
      if (worker) {
        worker.terminate();
        prepareWorkerRef.current = null;
      }
    };
  }, []);

  const validateFiles = (
    files: File[]
  ): { validFiles: File[]; errors: string[] } => {
    const validFiles: File[] = [];
    const errors: string[] = [];

    if (files.length > uploadConfig.maxFiles) {
      errors.push(`最多只能选择 ${uploadConfig.maxFiles} 个文件`);
      return { validFiles: [], errors };
    }

    files.forEach((file) => {
      if (file.size > uploadConfig.maxFileSize) {
        errors.push(
          `文件 "${file.name}" 大小超过限制 (${Math.round(
            uploadConfig.maxFileSize / 1024 / 1024
          )}MB)`
        );
        return;
      }

      if (uploadConfig.allowedFileTypes.length > 0) {
        const fileExtension = file.name.split(".").pop()?.toLowerCase();
        const mimeType = file.type.toLowerCase();

        const isAllowed = uploadConfig.allowedFileTypes.some((type: string) => {
          if (type.startsWith(".")) {
            return fileExtension === type.slice(1).toLowerCase();
          }
          return mimeType.includes(type.toLowerCase());
        });

        if (!isAllowed) {
          errors.push(`文件 "${file.name}" 类型不被允许`);
          return;
        }
      }

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

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const files = Array.from(e.target.files);
    e.target.value = "";

    if (isNetworkOffline) {
      messageApi.error("网络已断开，无法上传文件");
      return;
    }

    const { validFiles, errors } = validateFiles(files);

    if (errors.length > 0) {
      errors.forEach((error) => messageApi.error(error));
      if (validFiles.length === 0) return;
    }

    if (validFiles.length === 0) {
      messageApi.warning("没有有效的文件可以上传");
      return;
    }

    fileStartTimesRef.current = {};
    setFileTimings({});

    setLoading(true);
    const startTime = Date.now();

    validFiles.forEach((file) => {
      fileStartTimesRef.current[file.name] = Date.now();
    });

    const existingWorker = prepareWorkerRef.current;
    if (existingWorker) {
      existingWorker.terminate();
      prepareWorkerRef.current = null;
    }

    const worker = createFilePrepareWorker();
    prepareWorkerRef.current = worker;

    try {
      await new Promise<void>((resolve, reject) => {
        worker.onerror = (event) => {
          reject(new Error(event.message || "文件预处理失败"));
        };

        worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
          void (async () => {
            const data = event.data;

            if (data.type === "progress") {
              setProcessProgress({
                processed: data.processed,
                total: data.total,
                success: data.success,
                failed: data.failed,
                oversized: data.oversized,
              });

              if (data.fileDetails && data.fileDetails.fileName) {
                const fileName = data.fileDetails.fileName;
                const fileStartTime = fileStartTimesRef.current[fileName] || 0;
                if (fileStartTime > 0) {
                  const processingTime = Date.now() - fileStartTime;
                  setFileTimings((prev: Record<string, number>) => ({
                    ...prev,
                    [fileName]: processingTime,
                  }));
                  delete fileStartTimesRef.current[fileName];
                }
              }
              return;
            }

            if (data.type !== "complete") {
              return;
            }

            setProcessProgress(null);
            setLoading(false);

            const endTime = Date.now();
            const cost = endTime - startTime;
            setCost(cost);

            for (const file of data.uploadFiles) {
              await localforage.setItem(file.id, file);

              if (!fileStartTimesRef.current[file.fileName] && data.uploadFiles.length > 0) {
                setFileTimings((prev: Record<string, number>) => ({
                  ...prev,
                  [file.fileName]: Math.round(cost / data.uploadFiles.length),
                }));
              }
            }

            await refreshFiles();

            const resultMessage = `处理完成: ${data.stats.success}个成功, ${
              data.stats.failed
            }个失败${
              data.stats.oversized > 0 ? `, ${data.stats.oversized}个超过大小限制` : ""
            }`;
            messageApi.success(resultMessage);

            if (uploadConfig.autoUpload && data.stats.success > 0 && !isNetworkOffline) {
              setTimeout(() => {
                void uploadAll();
              }, 500);
            }

            resolve();
          })().catch(reject);
        };

        worker.postMessage({
          files: validFiles,
          networkParams: {
            networkType,
            fileConcurrency,
            chunkConcurrency,
            chunkSize,
          },
        });
      });
    } catch (error) {
      setProcessProgress(null);
      setLoading(false);
      messageApi.error(error instanceof Error ? error.message : "文件预处理失败");
    } finally {
      if (prepareWorkerRef.current === worker) {
        prepareWorkerRef.current = null;
      }
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
  };

  return {
    handleFileChange,
  };
}
