import { message } from "../../../ui";
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
  /**
   * 触发合并（P0-1）：下载完成后必须真正合并并写入 completeFileStore，
   * 否则「导出」会因分片已被清理而必然失败。
   */
  mergeFile: (file: DownloadFile) => Promise<void>;
}

export const createDownloadEventHandlers = ({
  chunkService,
  mergeService,
  removeProcessing,
  updateFile,
  mergeFile,
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

    // 分片齐全后必须真正合并：合并成功会写入 completeFileStore，
    // 随后由 handleMergeComplete / 主线程兜底路径清理分片。
    try {
      await mergeFile(file);
    } catch (err) {
      updateFile(file.id, {
        status: DownloadStatus.ERROR,
        error: `合并文件失败: ${err instanceof Error ? err.message : "未知错误"}`,
      });
      removeProcessing(file.id);
      message.error(`文件 ${file.fileName} 合并失败`);
    }
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
    // merge worker 路径同样要清理分片（P2-15）：与主线程兜底路径保持一致，
    // 避免 chunks + completeFiles 双份占用配额。
    void chunkService
      .removeAllChunks(file.id, file.totalChunks)
      .catch(() => undefined);
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
