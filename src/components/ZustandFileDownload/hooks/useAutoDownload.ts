import { useCallback, useEffect, useState } from "react";

import { DownloadFileItem } from "../api.client.d";
import api from "../api.client";
import { useDownloadStore } from "../store/download";
import useFileDownloader from "./useFileDownloader";

interface UseAutoDownloadOptions {
  autoLoad?: boolean; // 是否自动加载文件列表
  autoDownload?: boolean; // 是否自动开始下载
  filter?: (file: DownloadFileItem) => boolean; // 过滤函数
  interval?: number; // 自动刷新间隔（毫秒）
  onLoaded?: (files: DownloadFileItem[]) => void; // 加载完成回调
  onError?: (error: Error) => void; // 错误回调
}

/**
 * 自动加载和下载文件的钩子
 */
const useAutoDownload = (options: UseAutoDownloadOptions = {}) => {
  const {
    autoLoad = false,
    autoDownload = false,
    filter,
    interval = 0,
    onLoaded,
    onError,
  } = options;

  const [files, setFiles] = useState<DownloadFileItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const { downloadFile } = useFileDownloader();
  const { downloadTasks } = useDownloadStore();

  // 加载文件列表
  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 从API获取文件列表
      const downloadFiles = await api.getDownloadFiles();

      // 应用过滤器（如果提供）
      const filteredFiles = filter
        ? downloadFiles.filter(filter)
        : downloadFiles;

      setFiles(filteredFiles);

      // 调用加载完成回调
      if (onLoaded) {
        onLoaded(filteredFiles);
      }

      return filteredFiles;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("加载下载文件列表失败:", error);
      setError(error);

      // 调用错误回调
      if (onError) {
        onError(error);
      }

      return [];
    } finally {
      setLoading(false);
    }
  }, [filter, onLoaded, onError]);

  // 自动下载文件
  const startDownload = useCallback(
    async (filesToDownload: DownloadFileItem[]) => {
      if (!filesToDownload || filesToDownload.length === 0) {
        return [];
      }

      try {
        // 过滤掉已经在下载队列中的文件
        const newFiles = filesToDownload.filter(
          (file) =>
            !downloadTasks.some(
              (task) =>
                task.url === file.url ||
                (file.metadata?.md5 && task.metadata?.md5 === file.metadata.md5)
            )
        );

        if (newFiles.length === 0) {
          console.log("没有新文件需要下载");
          return [];
        }

        console.log(`添加 ${newFiles.length} 个文件到下载队列`);

        // 添加到下载队列
        const taskIds = await Promise.all(
          newFiles.map((file) =>
            downloadFile(file.url, file.fileName, {
              fileSize: file.fileSize,
              mimeType: file.mimeType,
              metadata: file.metadata,
            })
          )
        );

        return taskIds.filter(Boolean);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error("自动下载文件失败:", error);

        if (onError) {
          onError(error);
        }

        return [];
      }
    },
    [downloadFile, downloadTasks, onError]
  );

  // 自动加载效果
  useEffect(() => {
    if (autoLoad) {
      loadFiles().then((loadedFiles) => {
        // 如果同时启用了自动下载，则开始下载
        if (autoDownload && loadedFiles.length > 0) {
          startDownload(loadedFiles);
        }
      });
    }
  }, [autoLoad, autoDownload, loadFiles, startDownload]);

  // 定时刷新效果
  useEffect(() => {
    if (interval > 0 && autoLoad) {
      const timer = setInterval(async () => {
        const loadedFiles = await loadFiles();

        // 如果同时启用了自动下载，则开始下载
        if (autoDownload && loadedFiles.length > 0) {
          startDownload(loadedFiles);
        }
      }, interval);

      return () => clearInterval(timer);
    }
  }, [interval, autoLoad, autoDownload, loadFiles, startDownload]);

  // 手动开始下载全部文件
  const downloadAll = useCallback(async () => {
    return startDownload(files);
  }, [files, startDownload]);

  // 手动开始下载单个文件
  const downloadOne = useCallback(
    async (fileId: string) => {
      const file = files.find((f) => f.id === fileId);
      if (!file) {
        throw new Error(`未找到ID为 ${fileId} 的文件`);
      }

      return startDownload([file]);
    },
    [files, startDownload]
  );

  return {
    files,
    loading,
    error,
    loadFiles,
    downloadAll,
    downloadOne,
  };
};

export default useAutoDownload;
