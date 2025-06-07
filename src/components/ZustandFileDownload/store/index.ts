import { DownloadState } from "../types";
import { create } from "zustand";

// 创建下载状态存储
export const useDownloadStore = create<DownloadState>((set) => ({
  // 状态
  files: [],
  fetchingFiles: false,
  storageUsage: {
    usage: 0,
    quota: 0,
    percent: 0,
    isLoading: false,
    lastUpdated: 0,
  },
  // 网络相关状态
  networkType: "4G",
  chunkSize: 1024 * 1024,
  fileConcurrency: 3,
  chunkConcurrency: 3,
  isNetworkOffline: false,

  abortControllers: {},

  // Actions
  setFiles: (files) => set({ files }),

  setFetchingFiles: (fetchingFiles) => set({ fetchingFiles }),

  updateFile: (fileId, updates) =>
    set((state) => ({
      files: state.files.map((file) =>
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

  // 网络状态更新
  updateNetworkStatus: (updates) =>
    set((state) => ({
      ...state,
      ...updates,
    })),
}));
