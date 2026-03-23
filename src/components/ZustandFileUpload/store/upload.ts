import {
  BatchInfo,
  ProcessProgress,
  UploadConfig,
  UploadFile,
  UploadSettingsSource,
} from "../types/upload";

import { MessageInstance } from "antd/es/message/interface";
import { create } from "zustand";
import { message } from "antd";
import { listUploadFiles } from "../services/uploadStorage";

type ProgressMapUpdater =
  | Record<string, number>
  | ((prev: Record<string, number>) => Record<string, number>);

type BatchInfoUpdater =
  | BatchInfo
  | null
  | ((prev: BatchInfo | null) => BatchInfo | null);

type FileTimingsUpdater =
  | Record<string, number>
  | ((prev: Record<string, number>) => Record<string, number>);

type RetryingFilesUpdater =
  | Record<string, boolean>
  | ((prev: Record<string, boolean>) => Record<string, boolean>);

interface UploadState {
  files: UploadFile[];
  progressMap: Record<string, number>;
  retryingFiles: Record<string, boolean>;

  batchInfo: BatchInfo | null;
  processProgress: ProcessProgress | null;
  fileTimings: Record<string, number>;

  isUploading: boolean;
  isRetryingAll: boolean;
  loading: boolean;
  cost: number | null;

  networkType: string;
  fileConcurrency: number;
  chunkConcurrency: number;
  chunkSize: number;
  maxRetries: number;
  isNetworkOffline: boolean;

  autoUpload: boolean;
  autoCleanup: boolean;
  cleanupDelay: number;
  networkDisplayMode: "tooltip" | "direct";
  storageStatsVisible: boolean;

  config: UploadConfig | null;

  setFiles: (files: UploadFile[]) => void;
  refreshFiles: () => Promise<void>;
  setProgressMap: (progressMap: ProgressMapUpdater) => void;
  setBatchInfo: (batchInfo: BatchInfoUpdater) => void;
  setProcessProgress: (progress: ProcessProgress | null) => void;
  setFileTimings: (timings: FileTimingsUpdater) => void;
  setIsUploading: (isUploading: boolean) => void;
  setIsRetryingAll: (isRetryingAll: boolean) => void;
  setLoading: (loading: boolean) => void;
  setCost: (cost: number | null) => void;
  setAutoUpload: (autoUpload: boolean) => void;
  setAutoCleanup: (autoCleanup: boolean) => void;
  setCleanupDelay: (delay: number) => void;
  setNetworkDisplayMode: (mode: "tooltip" | "direct") => void;
  setStorageStatsVisible: (visible: boolean) => void;
  setRetryingFiles: (files: RetryingFilesUpdater) => void;
  setConfig: (config: UploadConfig) => void;

  getMessageApi: () => MessageInstance;
  initSettings: (defaults?: {
    autoUpload?: boolean;
    autoCleanup?: boolean;
    cleanupDelay?: number;
    networkDisplayMode?: "tooltip" | "direct";
    settingsSource?: UploadSettingsSource;
  }) => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  files: [],
  progressMap: {},
  retryingFiles: {},
  batchInfo: null,
  processProgress: null,
  fileTimings: {},
  isUploading: false,
  isRetryingAll: false,
  loading: false,
  cost: null,
  networkType: "unknown",
  fileConcurrency: 2,
  chunkConcurrency: 2,
  chunkSize: 1024 * 1024,
  maxRetries: 3,
  isNetworkOffline: false,
  autoUpload: true,
  autoCleanup: true,
  cleanupDelay: 10,
  networkDisplayMode: "tooltip",
  storageStatsVisible: false,
  config: null,

  setFiles: (files) => set({ files }),
  refreshFiles: async () => {
    const files = await listUploadFiles();
    set({ files });
  },
  setProgressMap: (progressMap) =>
    set((state) => ({
      progressMap:
        typeof progressMap === "function"
          ? progressMap(state.progressMap)
          : progressMap,
    })),
  setBatchInfo: (batchInfo) =>
    set((state) => ({
      batchInfo:
        typeof batchInfo === "function" ? batchInfo(state.batchInfo) : batchInfo,
    })),
  setProcessProgress: (processProgress) => set({ processProgress }),
  setFileTimings: (fileTimings) =>
    set((state) => ({
      fileTimings:
        typeof fileTimings === "function"
          ? fileTimings(state.fileTimings)
          : fileTimings,
    })),
  setIsUploading: (isUploading) => set({ isUploading }),
  setIsRetryingAll: (isRetryingAll) => set({ isRetryingAll }),
  setLoading: (loading) => set({ loading }),
  setCost: (cost) => set({ cost }),
  setAutoUpload: (autoUpload) => {
    localStorage.setItem("autoUpload", JSON.stringify(autoUpload));
    set({ autoUpload });
  },
  setAutoCleanup: (autoCleanup) => {
    localStorage.setItem("autoCleanup", JSON.stringify(autoCleanup));
    set({ autoCleanup });
  },
  setCleanupDelay: (delay) => {
    localStorage.setItem("cleanupDelay", JSON.stringify(delay));
    set({ cleanupDelay: delay });
  },
  setNetworkDisplayMode: (networkDisplayMode) => {
    localStorage.setItem("networkDisplayMode", networkDisplayMode);
    set({ networkDisplayMode });
  },
  setStorageStatsVisible: (storageStatsVisible) => set({ storageStatsVisible }),
  setRetryingFiles: (retryingFiles) =>
    set((state) => ({
      retryingFiles:
        typeof retryingFiles === "function"
          ? retryingFiles(state.retryingFiles)
          : retryingFiles,
    })),
  setConfig: (config) => {
    set({
      config,
      chunkSize: config.chunkSize,
      fileConcurrency: config.fileConcurrency,
      chunkConcurrency: config.chunkConcurrency,
      maxRetries: config.maxRetries,
    });
  },

  initSettings: (defaults) => {
    const settingsSource = defaults?.settingsSource ?? "localStorage";

    const autoUpload =
      settingsSource === "localStorage" && localStorage.getItem("autoUpload") !== null
        ? JSON.parse(localStorage.getItem("autoUpload") || "true")
        : defaults?.autoUpload ?? true;
    const autoCleanup =
      settingsSource === "localStorage" &&
      localStorage.getItem("autoCleanup") !== null
        ? JSON.parse(localStorage.getItem("autoCleanup") || "true")
        : defaults?.autoCleanup ?? true;
    const cleanupDelay =
      settingsSource === "localStorage" &&
      localStorage.getItem("cleanupDelay") !== null
        ? JSON.parse(localStorage.getItem("cleanupDelay") || "10")
        : defaults?.cleanupDelay ?? 10;
    const networkDisplayMode =
      settingsSource === "localStorage"
        ? ((localStorage.getItem("networkDisplayMode") as
            | "tooltip"
            | "direct") ||
          defaults?.networkDisplayMode ||
          "tooltip")
        : defaults?.networkDisplayMode || "tooltip";

    set({ autoUpload, autoCleanup, cleanupDelay, networkDisplayMode });
  },

  getMessageApi: () => message,
}));
