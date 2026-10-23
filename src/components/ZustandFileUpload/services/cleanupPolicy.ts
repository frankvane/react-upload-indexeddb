import { UploadFile, UploadStatus } from "../types/upload";
import type { FileRegistry } from "./fileRegistry";
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
  /** 该实例的 IndexedDB 存储（T3.2：替换全局 localforage 默认实例） */
  storage: LocalForage;
  /** 该实例的 File 引用注册表（T3.2：替换模块级单例） */
  fileRegistry: FileRegistry;
}

const canCleanup = (status: UploadStatus) =>
  status === UploadStatus.DONE || status === UploadStatus.INSTANT;

export class UploadCleanupPolicy {
  private readonly completedFileIds = new Set<string>();
  private countdownTimer: number | null = null;
  private countdownValue = 0;

  constructor(private readonly options: CleanupPolicyOptions) {}

  dispose() {
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
    const file = await this.options.storage.getItem<UploadFile>(fileId);
    if (!file) {
      return;
    }

    this.syncCompletedFile(file);
  }

  scheduleCleanup(seconds = this.options.getCleanupDelay()) {
    this.startCountdown(seconds);
  }

  async cleanupUploadedFiles() {
    const files = await listUploadFiles(this.options.storage);
    let markedCount = 0;

    for (const file of files) {
      if (!canCleanup(file.status)) {
        continue;
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
      const file = await this.options.storage.getItem<UploadFile>(id);
      if (!file) {
        this.completedFileIds.delete(id);
        continue;
      }

      if (file.status === UploadStatus.ERROR) {
        keepIds.push(id);
        continue;
      }

      if (canCleanup(file.status)) {
        await this.options.storage.removeItem(id);
        this.options.fileRegistry.releaseFileRef(id);
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

    // 单一触发源：仅由 setInterval 倒计时驱动清理，
    // 不再附加 setTimeout 兜底（避免双触发与后台标签页定时器不失效）
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
  }

  private async executeCleanup() {
    this.dispose();

    const ids = Array.from(this.completedFileIds);
    for (const id of ids) {
      const file = await this.options.storage.getItem<UploadFile>(id);
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
