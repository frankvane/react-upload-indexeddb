import { UploadFile, UploadStatus } from "../types/upload";
import localforage from "localforage";
import { listUploadFiles } from "./uploadStorage";

interface BatchInfo {
  current: number;
  total: number;
  queued: number;
  active: number;
  completed: number;
  failed: number;
  retried: number;
  countdown?: number;
}

interface CleanupPolicyOptions {
  getFiles: () => UploadFile[];
  setFiles: (files: UploadFile[]) => void;
  refreshFiles: () => Promise<void>;
  setBatchInfo: (
    updater:
      | BatchInfo
      | null
      | ((prev: BatchInfo | null) => BatchInfo | null)
  ) => void;
  clearBatchInfo: () => void;
  getCleanupDelay: () => number;
}

const canCleanup = (status: UploadStatus) =>
  status === UploadStatus.DONE || status === UploadStatus.INSTANT;

export class UploadCleanupPolicy {
  private readonly completedFileIds = new Set<string>();
  private cleanupTimer: number | null = null;
  private countdownTimer: number | null = null;
  private countdownValue = 0;

  constructor(private readonly options: CleanupPolicyOptions) {}

  dispose() {
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  pendingCount() {
    return this.completedFileIds.size;
  }

  private syncCompletedFile(file: UploadFile) {
    if (canCleanup(file.status)) {
      this.completedFileIds.add(file.id);
      return;
    }

    this.completedFileIds.delete(file.id);
  }

  async addCompletedFile(fileId: string) {
    const file = await localforage.getItem<UploadFile>(fileId);
    if (!file) {
      return;
    }

    this.syncCompletedFile(file);
  }

  scheduleCleanup(seconds = this.options.getCleanupDelay()) {
    this.startCountdown(seconds);
  }

  async cleanupUploadedFiles() {
    const files = await listUploadFiles();
    let markedCount = 0;

    for (const file of files) {
      if (!canCleanup(file.status)) {
        continue;
      }

      if (file.buffer) {
        file.buffer = undefined;
        await localforage.setItem(file.id, file);
      }

      this.syncCompletedFile(file);
      markedCount += 1;
    }

    if (markedCount === 0) {
      return;
    }

    const delay = this.options.getCleanupDelay();
    this.options.setBatchInfo({
      current: markedCount,
      total: markedCount,
      queued: 0,
      active: 0,
      completed: markedCount,
      failed: 0,
      retried: 0,
      countdown: delay,
    });

    this.startCountdown(delay);
  }

  async cleanupCompletedFilesFromIndexedDB() {
    const ids = Array.from(this.completedFileIds);
    const keepIds: string[] = [];

    for (const id of ids) {
      const file = await localforage.getItem<UploadFile>(id);
      if (!file) {
        this.completedFileIds.delete(id);
        continue;
      }

      if (file.status === UploadStatus.ERROR) {
        keepIds.push(id);
        continue;
      }

      if (canCleanup(file.status)) {
        await localforage.removeItem(id);
        this.completedFileIds.delete(id);
      }
    }

    for (const keepId of keepIds) {
      this.completedFileIds.delete(keepId);
    }

    await this.options.refreshFiles();
  }

  cleanupCompletedFilesFromUI() {
    if (this.completedFileIds.size === 0) {
      return;
    }

    const ids = new Set(this.completedFileIds);
    const currentFiles = this.options.getFiles();

    const nextFiles = currentFiles.filter((file) => {
      if (!ids.has(file.id)) {
        return true;
      }

      if (file.status === UploadStatus.ERROR) {
        this.completedFileIds.delete(file.id);
        return true;
      }

      return false;
    });

    this.options.setFiles(nextFiles);
  }

  async forceCleanupUI() {
    if (this.cleanupTimer !== null) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    await this.cleanupCompletedFilesFromIndexedDB();
    this.cleanupCompletedFilesFromUI();
    await this.options.refreshFiles();
  }

  private startCountdown(seconds: number) {
    this.dispose();

    this.countdownValue = seconds;
    this.options.setBatchInfo((prev) => {
      if (!prev) {
        return null;
      }

      return {
        ...prev,
        countdown: this.countdownValue,
      };
    });

    this.countdownTimer = window.setInterval(() => {
      this.countdownValue -= 1;

      this.options.setBatchInfo((prev) => {
        if (!prev) {
          return null;
        }

        return {
          ...prev,
          countdown: this.countdownValue,
        };
      });

      if (this.countdownValue <= 0) {
        void this.executeCleanup();
      }
    }, 1000);

    this.cleanupTimer = window.setTimeout(() => {
      void this.executeCleanup();
    }, seconds * 1000);
  }

  private async executeCleanup() {
    this.dispose();

    const ids = Array.from(this.completedFileIds);
    for (const id of ids) {
      const file = await localforage.getItem<UploadFile>(id);
      if (file?.status === UploadStatus.ERROR) {
        this.completedFileIds.delete(id);
      }
    }

    await this.cleanupCompletedFilesFromIndexedDB();
    this.cleanupCompletedFilesFromUI();
    await this.options.refreshFiles();

    setTimeout(() => {
      this.options.clearBatchInfo();
    }, 1000);
  }
}
