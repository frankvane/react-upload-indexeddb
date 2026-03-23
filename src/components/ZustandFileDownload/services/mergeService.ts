import { DownloadFile, DownloadStatus } from "../types";
import { completeFileStore, fileStore, mergeFileChunks } from "../utils";

interface MergeServiceOptions {
  updateFile: (fileId: string, updates: Partial<DownloadFile>) => void;
  onStorageUpdated?: () => void;
}

interface MissingChunkUpdate {
  status: typeof DownloadStatus.PAUSED;
  downloadedChunks: number;
  progress: number;
  error?: string;
}

export class MergeService {
  constructor(private readonly options: MergeServiceOptions) {}

  private async persistFileUpdate(file: DownloadFile, updates: Partial<DownloadFile>) {
    this.options.updateFile(file.id, updates);
    await fileStore.setItem(file.id, {
      ...file,
      ...updates,
    });
  }

  async markCompleted(file: DownloadFile) {
    const updates = {
      status: DownloadStatus.COMPLETED,
      progress: 100,
      completedAt: Date.now(),
      error: undefined,
    } as const;

    await this.persistFileUpdate(file, updates);
    this.options.onStorageUpdated?.();
  }

  async markPausedForMissingChunks(file: DownloadFile, missingChunks: number[], reason?: string) {
    const downloadedChunks = file.totalChunks - missingChunks.length;
    const updates: MissingChunkUpdate = {
      status: DownloadStatus.PAUSED,
      downloadedChunks,
      progress: Math.round((downloadedChunks / file.totalChunks) * 100),
      error: reason,
    };

    await this.persistFileUpdate(file, updates);
  }

  async hasMergedFile(fileId: string) {
    await completeFileStore.ready();
    const completeFile = await completeFileStore.getItem<Blob>(fileId);
    return Boolean(completeFile);
  }

  async saveMergedBlob(file: DownloadFile, blob: Blob) {
    await completeFileStore.ready();
    await completeFileStore.setItem(file.id, blob);
    await this.markCompleted(file);
  }

  async mergeInMainThread(file: DownloadFile) {
    const mergedBlob = await mergeFileChunks(file);
    await this.saveMergedBlob(file, mergedBlob);
  }
}

