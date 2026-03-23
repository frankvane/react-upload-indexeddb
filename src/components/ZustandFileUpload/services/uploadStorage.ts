import { UploadStatus, type UploadFile } from "../types/upload";
import localforage from "localforage";

const isUploadFile = (value: unknown): value is UploadFile => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeFile = value as Partial<UploadFile>;
  return (
    typeof maybeFile.id === "string" &&
    typeof maybeFile.fileName === "string" &&
    typeof maybeFile.createdAt === "number"
  );
};

export const listUploadFiles = async (): Promise<UploadFile[]> => {
  const files: UploadFile[] = [];

  await localforage.iterate<unknown, void>((value) => {
    if (isUploadFile(value)) {
      files.push(value);
    }
  });

  files.sort((a, b) => a.createdAt - b.createdAt);
  return files;
};

export const removeUploadFilesByIds = async (ids: string[]): Promise<void> => {
  if (ids.length === 0) {
    return;
  }

  await Promise.all(ids.map((id) => localforage.removeItem(id)));
};

const interruptedUploadStatuses = new Set<UploadStatus>([
  UploadStatus.CALCULATING,
  UploadStatus.PREPARING_UPLOAD,
  UploadStatus.UPLOADING,
  UploadStatus.QUEUED_FOR_UPLOAD,
]);

export const isUploadableStatus = (status: UploadStatus) =>
  status === UploadStatus.QUEUED ||
  status === UploadStatus.QUEUED_FOR_UPLOAD ||
  status === UploadStatus.CALCULATING ||
  status === UploadStatus.PREPARING_UPLOAD ||
  status === UploadStatus.UPLOADING ||
  status === UploadStatus.PAUSED ||
  status === UploadStatus.ERROR ||
  status === UploadStatus.MERGE_ERROR;

export interface UploadRecoverySummary {
  totalInterrupted: number;
  recoveredCount: number;
  missingBufferCount: number;
}

export const recoverInterruptedUploadFiles =
  async (): Promise<UploadRecoverySummary> => {
    const files = await listUploadFiles();
    let recoveredCount = 0;
    let missingBufferCount = 0;
    let totalInterrupted = 0;

    for (const file of files) {
      if (!interruptedUploadStatuses.has(file.status)) {
        continue;
      }

      totalInterrupted += 1;

      if (file.buffer) {
        const nextFile: UploadFile = {
          ...file,
          status: UploadStatus.QUEUED,
          errorMessage: undefined,
        };
        await localforage.setItem(file.id, nextFile);
        recoveredCount += 1;
        continue;
      }

      const brokenFile: UploadFile = {
        ...file,
        status: UploadStatus.ERROR,
        progress: 0,
        errorMessage: "检测到页面刷新导致上传中断，文件缓存缺失，请重新选择文件",
      };
      await localforage.setItem(file.id, brokenFile);
      missingBufferCount += 1;
    }

    return {
      totalInterrupted,
      recoveredCount,
      missingBufferCount,
    };
  };
