import { AddDownloadTaskParams } from "../types/download";
import useBatchDownloader from "./useBatchDownloader";
import { useCallback } from "react";
import { useDownloadStore } from "../store/download";

/**
 * 文件下载钩子
 *
 * 提供简单的文件下载功能接口
 */
const useFileDownloader = () => {
  const { addDownloadTask } = useDownloadStore();
  const { downloadAll } = useBatchDownloader();

  /**
   * 下载单个文件
   *
   * @param url 文件URL
   * @param fileName 文件名
   * @param options 其他选项
   * @returns 下载任务ID
   */
  const downloadFile = useCallback(
    async (
      url: string,
      fileName: string,
      options?: Omit<AddDownloadTaskParams, "url" | "fileName">
    ) => {
      // 添加下载任务
      const taskId = await addDownloadTask({
        url,
        fileName,
        ...options,
      });

      // 如果配置了自动开始下载，返回任务ID
      if (taskId) {
        // 尝试开始下载
        downloadAll();
        return taskId;
      }

      return null;
    },
    [addDownloadTask, downloadAll]
  );

  /**
   * 批量下载文件
   *
   * @param files 文件列表，每个文件包含url和fileName
   * @returns 下载任务ID列表
   */
  const downloadFiles = useCallback(
    async (
      files: Array<{
        url: string;
        fileName: string;
        options?: Omit<AddDownloadTaskParams, "url" | "fileName">;
      }>
    ) => {
      if (!files || files.length === 0) {
        return [];
      }

      // 添加所有下载任务
      const taskIds = await Promise.all(
        files.map(async (file) => {
          return await addDownloadTask({
            url: file.url,
            fileName: file.fileName,
            ...file.options,
          });
        })
      );

      // 开始下载
      downloadAll();

      return taskIds.filter(Boolean);
    },
    [addDownloadTask, downloadAll]
  );

  return {
    downloadFile,
    downloadFiles,
  };
};

export default useFileDownloader;
