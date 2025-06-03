import { UploadFile, UploadStatus } from "../types/upload";
import { useEffect, useState } from "react";

import { MessageInstance } from "antd/es/message/interface";

interface UseNetworkStatusHandlerOptions {
  networkType: string;
  isUploading: boolean;
  cancelUpload: () => void;
  uploadAll: () => Promise<boolean>;
  retryAllFailedFiles: () => Promise<{
    success: boolean;
    message: string;
    retriedCount: number;
  }>;
  allFiles: UploadFile[];
  messageApi: MessageInstance;
}

export const useNetworkStatusHandler = ({
  networkType,
  isUploading,
  cancelUpload,
  uploadAll,
  retryAllFailedFiles,
  allFiles,
  messageApi,
}: UseNetworkStatusHandlerOptions) => {
  const [previousNetworkState, setPreviousNetworkState] = useState<
    string | null
  >(null);

  // 在网络状态变化时显示提示和处理
  useEffect(() => {
    // 保存之前的网络状态
    if (previousNetworkState !== networkType) {
      // 网络从离线到在线
      if (previousNetworkState === "offline" && networkType !== "offline") {
        messageApi.success(`网络已恢复 (${networkType})，正在自动恢复上传任务`);

        // 将处理逻辑延迟一秒，确保UI更新和用户能看到提示
        setTimeout(() => {
          // 对所有文件按状态分类
          const errorFiles = allFiles.filter(
            (file) =>
              file.status === UploadStatus.ERROR ||
              file.status === UploadStatus.MERGE_ERROR
          );
          const pendingFiles = allFiles.filter(
            (file) =>
              file.status === UploadStatus.CALCULATING ||
              file.status === UploadStatus.UPLOADING ||
              file.status === UploadStatus.QUEUED ||
              file.status === UploadStatus.QUEUED_FOR_UPLOAD ||
              file.status === UploadStatus.PREPARING_UPLOAD
          );
          const waitingFiles = allFiles.filter(
            (file) => file.status === UploadStatus.PAUSED
          );
          const completedFiles = allFiles.filter(
            (file) =>
              file.status === UploadStatus.DONE ||
              file.status === UploadStatus.INSTANT
          );

          // 统计各类文件数量
          const totalErrors = errorFiles.length;
          const totalPending = pendingFiles.length;
          const totalWaiting = waitingFiles.length;
          const totalToProcess = totalErrors + totalPending + totalWaiting;

          console.log("网络恢复后文件状态:", {
            errorFiles: totalErrors,
            pendingFiles: totalPending,
            waitingFiles: totalWaiting,
            completedFiles: completedFiles.length,
            totalToProcess,
          });

          // 如果没有需要处理的文件，直接退出
          if (totalToProcess === 0) {
            messageApi.info("没有需要上传的文件");
            return;
          }

          // 处理策略：先重试错误文件，然后继续上传所有其他文件

          // 如果有错误文件，先重试
          if (totalErrors > 0) {
            messageApi.info(`正在重试 ${totalErrors} 个失败文件...`);

            retryAllFailedFiles()
              .then((result) => {
                if (result.success) {
                  messageApi.success(result.message);
                } else {
                  messageApi.error(result.message);
                }
              })
              .catch((error) => {
                console.error("自动重试失败:", error);
                messageApi.error(
                  `自动重试出错: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
              })
              .finally(() => {
                // 重试完成后，如果还有待上传的文件，继续上传所有文件
                if (totalPending + totalWaiting > 0) {
                  messageApi.info(
                    `继续上传 ${totalPending + totalWaiting} 个排队中的文件...`
                  );
                  // 等待一小段时间再上传，避免UI更新冲突
                  setTimeout(() => {
                    uploadAll();
                  }, 500);
                }
              });
          }
          // 如果没有错误文件但有其他待处理文件，直接继续上传
          else if (totalPending + totalWaiting > 0) {
            messageApi.info(
              `继续上传 ${totalPending + totalWaiting} 个文件...`
            );
            uploadAll();
          }
        }, 1000);
      }
      // 网络从在线到离线
      else if (
        previousNetworkState !== "offline" &&
        networkType === "offline"
      ) {
        messageApi.error("网络已断开，上传操作已暂停");

        // 如果正在上传，则取消上传
        if (isUploading) {
          cancelUpload();
        }
      }

      // 更新之前的网络状态
      setPreviousNetworkState(networkType);
    }
  }, [
    networkType,
    previousNetworkState,
    messageApi,
    allFiles,
    isUploading,
    cancelUpload,
    uploadAll,
    retryAllFailedFiles,
  ]);

  return {};
};
