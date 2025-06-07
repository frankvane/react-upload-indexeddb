import * as apiClient from "../api.client.js";

import { DownloadState, NetworkStatusUpdate } from "../types";
import { createJSONStorage, devtools, persist } from "zustand/middleware";

import { DownloadStatus } from "../types/download";
import { create } from "zustand";

// 创建下载状态存储
export const useDownloadStore = create<DownloadState>()(
  devtools(
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

        // 文件列表请求状态
        lastFetchTime: 0,
        isFetchingFileList: false,

        // Actions
        setFiles: (files) => set({ files }, false, "setFiles"),

        setFetchingFiles: (fetchingFiles) =>
          set({ fetchingFiles }, false, "setFetchingFiles"),

        updateFile: (fileId, updates) =>
          set(
            (state) => ({
              files: state.files.map((file) =>
                file.id === fileId ? { ...file, ...updates } : file
              ),
            }),
            false,
            "updateFile"
          ),

        addAbortController: (fileId, controller) =>
          set(
            (state) => ({
              abortControllers: {
                ...state.abortControllers,
                [fileId]: controller,
              },
            }),
            false,
            "addAbortController"
          ),

        removeAbortController: (fileId) =>
          set(
            (state) => {
              const newAbortControllers = { ...state.abortControllers };
              delete newAbortControllers[fileId];
              return { abortControllers: newAbortControllers };
            },
            false,
            "removeAbortController"
          ),

        updateStorageUsage: (updates) =>
          set(
            (state) => ({
              storageUsage: {
                ...state.storageUsage,
                ...updates,
              },
            }),
            false,
            "updateStorageUsage"
          ),

        // 获取下载文件列表（从API获取）
        fetchDownloadFiles: async (params = {}, forceUpdate = false) => {
          const state = get();

          // 如果已经在获取中，直接返回当前状态
          if (state.isFetchingFileList) {
            return state.files;
          }

          // 检查是否需要强制更新或者距离上次请求已经超过5秒
          const now = Date.now();
          const shouldFetch =
            forceUpdate ||
            !state.lastFetchTime ||
            now - state.lastFetchTime > 5000;

          if (!shouldFetch) {
            return state.files;
          }

          try {
            // 设置获取状态
            set(
              { isFetchingFileList: true, fetchingFiles: true },
              false,
              "fetchDownloadFiles/start"
            );

            // 从API获取文件列表
            const downloadFiles = await apiClient.getDownloadFiles(params);

            // 处理文件数据，添加必要的字段
            const processedFiles = downloadFiles.map((file) => {
              const chunkSize = state.chunkSize;
              const totalChunks = Math.ceil(file.fileSize / chunkSize);

              return {
                ...file,
                totalChunks,
                downloadedChunks: 0,
                progress: 0,
                status: DownloadStatus.IDLE,
                chunkSize,
              };
            });

            // 更新状态，包括文件列表
            set(
              {
                lastFetchTime: now,
                isFetchingFileList: false,
                fetchingFiles: false,
                files: processedFiles, // 直接更新文件列表到store
              },
              false,
              "fetchDownloadFiles/success"
            );

            // 返回获取的文件列表
            return processedFiles;
          } catch (error) {
            console.error("获取文件列表失败:", error);
            set(
              {
                isFetchingFileList: false,
                fetchingFiles: false,
              },
              false,
              "fetchDownloadFiles/error"
            );
            throw error;
          }
        },

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

          // 更新状态，如果指定了manuallySet参数，则同时更新isManuallySet状态
          set(
            () => {
              // 构建更新对象
              const updateObj: Partial<DownloadState> = { ...updates };

              // 只有当manuallySet参数明确指定时才更新isManuallySet
              if (manuallySet !== undefined) {
                updateObj.isManuallySet = manuallySet;
              }

              return updateObj;
            },
            false,
            "updateNetworkStatus"
          );

          return chunkSizeChanged;
        },

        // 重置手动设置标记
        resetManualFlag: () =>
          set({ isManuallySet: false }, false, "resetManualFlag"),

        // 切换显示模式
        toggleDisplayMode: () =>
          set(
            (state) => ({
              displayMode:
                state.displayMode === "tooltip" ? "direct" : "tooltip",
            }),
            false,
            "toggleDisplayMode"
          ),
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
    ),
    {
      name: "ZustandFileDownload", // DevTools中显示的名称
      enabled: true, // 启用DevTools
    }
  )
);
