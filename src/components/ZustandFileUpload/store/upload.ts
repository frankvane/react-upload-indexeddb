import { BatchInfo, ProcessProgress, UploadFile, UploadConfig } from "../types/upload";

import { MessageInstance } from "antd/es/message/interface";
import { create } from "zustand";
import localforage from "localforage";
import { message } from "antd";

// 导入我们自己的类型定义

// 上传状态接口定义
interface UploadState {
  // 文件相关状态
  files: UploadFile[];
  progressMap: Record<string, number>;
  retryingFiles: Record<string, boolean>;

  // 批次信息
  batchInfo: BatchInfo | null;

  // 处理进度
  processProgress: ProcessProgress | null;
  fileTimings: Record<string, number>; // 每个文件的处理时间（毫秒）

  // 上传状态
  isUploading: boolean;
  isRetryingAll: boolean;
  loading: boolean;
  cost: number | null;

  // 网络状态
  networkType: string;
  fileConcurrency: number;
  chunkConcurrency: number;
  chunkSize: number;
  maxRetries: number; // 最大重试次数
  isNetworkOffline: boolean;

  // 设置
  autoUpload: boolean;
  autoCleanup: boolean;
  cleanupDelay: number; // 清理延迟时间（秒）
  networkDisplayMode: "tooltip" | "direct";
  storageStatsVisible: boolean;

  // 配置信息
  config: UploadConfig | null;

  // 操作方法
  setFiles: (files: UploadFile[]) => void;
  refreshFiles: () => Promise<void>;
  setProgressMap: (
    progressMap:
      | Record<string, number>
      | ((prev: Record<string, number>) => Record<string, number>)
  ) => void;
  setBatchInfo: (
    batchInfo: BatchInfo | null | ((prev: BatchInfo | null) => BatchInfo | null)
  ) => void;
  setProcessProgress: (progress: ProcessProgress | null) => void;
  setFileTimings: (
    timings:
      | Record<string, number>
      | ((prev: Record<string, number>) => Record<string, number>)
  ) => void;
  setIsUploading: (isUploading: boolean) => void;
  setIsRetryingAll: (isRetryingAll: boolean) => void;
  setLoading: (loading: boolean) => void;
  setCost: (cost: number | null) => void;
  setAutoUpload: (autoUpload: boolean) => void;
  setAutoCleanup: (autoCleanup: boolean) => void;
  setCleanupDelay: (delay: number) => void;
  setNetworkDisplayMode: (mode: "tooltip" | "direct") => void;
  setStorageStatsVisible: (visible: boolean) => void;
  setRetryingFiles: (files: Record<string, boolean>) => void;
  setConfig: (config: UploadConfig) => void;

  // 文件操作方法
  uploadAll: () => Promise<boolean>;
  cancelUpload: () => void;
  clearBatchInfo: () => void;
  retryUploadFile: (
    file: UploadFile
  ) => Promise<{ success: boolean; message: string }>;
  retryAllFailedFiles: () => Promise<{
    success: boolean;
    message: string;
    retriedCount: number;
  }>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDeleteFile: (id: string) => Promise<void>;
  handleRetryUpload: (file: UploadFile) => Promise<void>;
  handleClearList: () => Promise<boolean>;
  handleRetryAllUpload: () => Promise<{
    success: boolean;
    message: string;
    retriedCount: number;
  }>;
  handleClearUploadedFiles: () => Promise<boolean>;

  // 辅助方法
  getMessageApi: () => MessageInstance;

  // 初始化方法
  initSettings: () => void;
}

// 创建Zustand store
export const useUploadStore = create<UploadState>((set, get) => ({
  // 初始状态
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
  maxRetries: 3, // 默认最大重试3次
  isNetworkOffline: false,
  autoUpload: true,
  autoCleanup: true,
  cleanupDelay: 10, // 清理延迟时间（秒）
  networkDisplayMode: "tooltip",
  storageStatsVisible: false,
  config: null,

  // 状态设置方法
  setFiles: (files) => set({ files }),
  refreshFiles: async () => {
    // 从IndexedDB加载所有文件
    const keys = await localforage.keys();
    const files: UploadFile[] = [];

    for (const key of keys) {
      const file = await localforage.getItem<UploadFile>(key);
      if (file) {
        files.push(file);
      }
    }

    // 按创建时间排序
    files.sort((a, b) => a.createdAt - b.createdAt);
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
        typeof batchInfo === "function"
          ? batchInfo(state.batchInfo)
          : batchInfo,
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
  setRetryingFiles: (retryingFiles) => set({ retryingFiles }),
  setConfig: (config) => {
    set({
      config,
      chunkSize: config.chunkSize,
      fileConcurrency: config.fileConcurrency,
      chunkConcurrency: config.chunkConcurrency,
      maxRetries: config.maxRetries,
    });
  },

  // 初始化设置
  initSettings: () => {
    const autoUpload = JSON.parse(localStorage.getItem("autoUpload") || "true");
    const autoCleanup = JSON.parse(
      localStorage.getItem("autoCleanup") || "true"
    );
    const cleanupDelay = JSON.parse(
      localStorage.getItem("cleanupDelay") || "10"
    );
    const networkDisplayMode =
      (localStorage.getItem("networkDisplayMode") as "tooltip" | "direct") ||
      "tooltip";
    set({ autoUpload, autoCleanup, cleanupDelay, networkDisplayMode });
  },

  // 获取message API
  getMessageApi: () => {
    return message;
  },

  // 文件上传相关方法
  uploadAll: async () => {
    // 这些方法将在组件中通过钩子实现，这里仅提供接口
    // 实际逻辑将由useBatchUploader钩子提供
    return false;
  },
  cancelUpload: () => {
    set({ isUploading: false });
  },
  clearBatchInfo: () => {
    set({ batchInfo: null });
  },
  retryUploadFile: async () => {
    // 实际逻辑将由useBatchUploader钩子提供
    return { success: false, message: "" };
  },
  retryAllFailedFiles: async () => {
    // 实际逻辑将由useBatchUploader钩子提供
    return { success: false, message: "", retriedCount: 0 };
  },

  // 文件处理相关方法
  handleFileChange: async () => {
    // 实际逻辑将由useFileProcessor钩子提供
  },

  // 文件操作相关方法
  handleDeleteFile: async (id) => {
    try {
      await localforage.removeItem(id);
      await get().refreshFiles();
      message.success("文件已删除");
    } catch {
      message.error("删除文件失败");
    }
  },
  handleRetryUpload: async () => {
    // 实际逻辑将由useFileOperations钩子提供
  },
  handleClearList: async () => {
    try {
      // 获取所有文件ID
      const keys = await localforage.keys();

      // 删除所有文件
      for (const key of keys) {
        await localforage.removeItem(key);
      }

      await get().refreshFiles();
      message.success("文件列表已清空");
      return true;
    } catch {
      message.error("清空文件列表失败");
      return false;
    }
  },
  handleRetryAllUpload: async () => {
    // 实际逻辑将由useFileOperations钩子提供
    return { success: false, message: "", retriedCount: 0 };
  },
  handleClearUploadedFiles: async () => {
    try {
      // 获取所有文件
      const keys = await localforage.keys();
      let count = 0;

      for (const key of keys) {
        const file = await localforage.getItem<UploadFile>(key);
        if (file && (file.status === "done" || file.status === "instant")) {
          await localforage.removeItem(key);
          count++;
        }
      }

      await get().refreshFiles();
      message.success(`已清除 ${count} 个已上传文件`);
      return true;
    } catch {
      message.error("清除已上传文件失败");
      return false;
    }
  },
}));
