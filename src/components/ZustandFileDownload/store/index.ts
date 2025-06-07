import { DownloadState, NetworkStatusUpdate } from "../types";
import { createJSONStorage, persist } from "zustand/middleware";

import { create } from "zustand";

// 创建下载状态存储
export const useDownloadStore = create<DownloadState>()(
  persist(
    (set, get) => ({
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
      isManuallySet: false, // 默认不是手动设置
      displayMode: "tooltip", // 默认显示模式

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
      updateNetworkStatus: (
        updates: NetworkStatusUpdate,
        manuallySet?: boolean
      ) => {
        // 获取当前状态
        const currentState = get();

        // 如果没有实际更新，则不触发状态变更
        if (
          Object.keys(updates).length === 0 &&
          manuallySet === currentState.isManuallySet
        ) {
          return false;
        }

        // 检查chunkSize是否发生变化
        const chunkSizeChanged =
          updates.chunkSize !== undefined &&
          updates.chunkSize !== currentState.chunkSize;

        // 如果chunkSize发生变化，记录日志
        if (chunkSizeChanged) {
          console.log(
            `Store: chunkSize变化 ${currentState.chunkSize} -> ${updates.chunkSize}`
          );
        }

        // 更新状态，如果指定了manuallySet参数，则同时更新isManuallySet状态
        set(() => {
          // 构建更新对象
          const updateObj: Partial<DownloadState> = { ...updates };

          // 只有当manuallySet参数明确指定时才更新isManuallySet
          if (manuallySet !== undefined) {
            updateObj.isManuallySet = manuallySet;
          }

          return updateObj;
        });

        return chunkSizeChanged;
      },

      // 重置手动设置标记
      resetManualFlag: () => set({ isManuallySet: false }),

      // 切换显示模式
      toggleDisplayMode: () =>
        set((state) => ({
          displayMode: state.displayMode === "tooltip" ? "direct" : "tooltip",
        })),
    }),
    {
      name: "download-network-storage", // 存储的唯一名称
      storage: createJSONStorage(() => localStorage), // 使用localStorage
      partialize: (state) => ({
        // 只持久化网络相关设置
        networkType: state.networkType,
        chunkSize: state.chunkSize,
        fileConcurrency: state.fileConcurrency,
        chunkConcurrency: state.chunkConcurrency,
        isManuallySet: state.isManuallySet,
        displayMode: state.displayMode,
      }),
    }
  )
);
