import { message } from "antd";
import { DownloadFile, DownloadStatus } from "../types";
import { completeFileStore, fileStore } from "../utils";
import { ChunkPersistenceService } from "./chunkPersistenceService";
import { MergeService } from "./mergeService";

interface DownloadCompletePayload {
  fileId: string;
}

interface DownloadErrorPayload {
  fileId: string;
  error: string;
}

interface DownloadPausedPayload {
  fileId: string;
}

interface MergeCompletePayload {
  fileId: string;
  blob: Blob;
}

interface MergeErrorPayload {
  fileId: string;
  error: string;
}

interface DownloadEventHandlerDeps {
  chunkService: ChunkPersistenceService;
  mergeService: MergeService;
  removeProcessing: (fileId: string) => void;
  updateFile: (fileId: string, updates: Partial<DownloadFile>) => void;
}

export const createDownloadEventHandlers = ({
  chunkService,
  mergeService,
  removeProcessing,
  updateFile,
}: DownloadEventHandlerDeps) => ({
  handleDownloadComplete: async (payload: DownloadCompletePayload) => {
    const file = await fileStore.getItem<DownloadFile>(payload.fileId);
    if (!file) {
      removeProcessing(payload.fileId);
      return;
    }

    const health = await chunkService.getChunkHealth(file.id, file.totalChunks);

    if (!health.allChunksExist) {
      await chunkService.removeCorruptChunks(file.id, health.corruptChunks);
      const reason = `有分片缺失/损坏（缺失: ${health.missingChunks.length}, 损坏: ${health.corruptChunks.length}），请点击继续重试`;
      await mergeService.markPausedForMissingChunks(
        file,
        [...health.missingChunks, ...health.corruptChunks],
        reason
      );
      removeProcessing(file.id);
      message.warning(`文件 ${file.fileName} 下载不完整，请点击继续重试`);
      return;
    }

    await mergeService.markCompleted(file);
    removeProcessing(file.id);
  },

  handleDownloadError: (payload: DownloadErrorPayload) => {
    updateFile(payload.fileId, {
      status: DownloadStatus.ERROR,
      error: payload.error,
    });
    removeProcessing(payload.fileId);
    message.error(`下载失败: ${payload.error}`);
  },

  handleMergeComplete: async (payload: MergeCompletePayload) => {
    await completeFileStore.ready();
    await completeFileStore.setItem(payload.fileId, payload.blob);

    const file = await fileStore.getItem<DownloadFile>(payload.fileId);
    if (!file) {
      removeProcessing(payload.fileId);
      return;
    }

    await mergeService.markCompleted(file);
    removeProcessing(payload.fileId);
  },

  handleMergeError: (payload: MergeErrorPayload) => {
    updateFile(payload.fileId, {
      status: DownloadStatus.ERROR,
      error: `合并文件失败: ${payload.error}`,
    });
    removeProcessing(payload.fileId);
    message.error(`合并文件失败: ${payload.error}`);
  },

  handleDownloadPaused: async (payload: DownloadPausedPayload) => {
    const file = await fileStore.getItem<DownloadFile>(payload.fileId);
    if (!file) {
      removeProcessing(payload.fileId);
      return;
    }

    const downloadedChunks = await chunkService.countDownloadedChunks(
      file.id,
      file.totalChunks
    );
    const progress = Math.round((downloadedChunks / file.totalChunks) * 100);

    updateFile(file.id, {
      status: DownloadStatus.PAUSED,
      progress,
      downloadedChunks,
    });

    await fileStore.setItem(file.id, {
      ...file,
      status: DownloadStatus.PAUSED,
      progress,
      downloadedChunks,
    });

    removeProcessing(file.id);
  },
});
