import { DownloadState } from "../types";
import { create } from "zustand";

// 创建下载状态存储
export const useDownloadStore = create<DownloadState>((set) => ({
  // 状态
  files: [],
  storedFiles: [],
  fetchingFiles: false,
  storageUsage: {
    usage: 0,
    quota: 0,
    percent: 0,
    isLoading: false,
    lastUpdated: 0,
    estimatedUsage: 0,
  },
  abortControllers: {},

  // Actions
  setFiles: (files) => set({ files }),

  setStoredFiles: (storedFiles) => set({ storedFiles }),

  setFetchingFiles: (fetchingFiles) => set({ fetchingFiles }),

  updateFile: (fileId, updates) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === fileId ? { ...file, ...updates } : file
      ),
      storedFiles: state.storedFiles.map((file) =>
        file.id === fileId ? { ...file, ...updates } : file
      ),
    })),

  addAbortController: (fileId, controller) =>
    set((state) => ({
      abortControllers: {
        ...state.abortControllers,
        [fileId]: controller,
      },
    })),

  removeAbortController: (fileId) =>
    set((state) => {
      const newAbortControllers = { ...state.abortControllers };
      delete newAbortControllers[fileId];
      return { abortControllers: newAbortControllers };
    }),

  updateStorageUsage: (updates) =>
    set((state) => ({
      storageUsage: {
        ...state.storageUsage,
        ...updates,
      },
    })),

  updateLocalSizeEstimate: (sizeChange) =>
    set((state) => {
      // 确保estimatedUsage存在
      const currentEstimatedUsage =
        state.storageUsage.estimatedUsage || state.storageUsage.usage || 0;

      // 计算新的估计使用量，确保不会小于0
      const newEstimatedUsage = Math.max(0, currentEstimatedUsage + sizeChange);

      // 计算新的百分比
      const newPercent =
        state.storageUsage.quota > 0
          ? (newEstimatedUsage / state.storageUsage.quota) * 100
          : state.storageUsage.percent;

      console.log(
        `更新存储估算: 变化 ${sizeChange} 字节, 新估计值: ${newEstimatedUsage} 字节, 新百分比: ${newPercent.toFixed(
          2
        )}%`
      );

      return {
        storageUsage: {
          ...state.storageUsage,
          estimatedUsage: newEstimatedUsage,
          percent: newPercent,
          lastUpdated: Date.now(), // 更新最后更新时间
        },
      };
    }),

  resetStorageEstimate: () =>
    set((state) => ({
      storageUsage: {
        ...state.storageUsage,
        estimatedUsage: 0,
        percent: 0,
      },
    })),
}));
