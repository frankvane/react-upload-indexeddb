import {
  AddDownloadTaskParams,
  BatchInfo,
  DownloadConfig,
  DownloadState,
  DownloadStatus,
  DownloadTask,
  NetworkType,
  StorageUsage,
} from "../types/download";
import { devtools, persist } from "zustand/middleware";

import { create } from "zustand";
import { message } from "antd";
import { v4 as uuidv4 } from "uuid";

// 默认配置
const DEFAULT_CONFIG: DownloadConfig = {
  chunkSize: 5 * 1024 * 1024, // 5MB
  maxConcurrentDownloads: 3,
  maxConcurrentChunks: 5,
  autoStart: false,
  storageQuota: 1024 * 1024 * 1024, // 1GB
  retryTimes: 3,
  retryDelay: 1000,
  autoCleanup: true,
  cleanupDelay: 3600000, // 1小时
  useFileSystemAPI: true,
  validateChunks: true,
  networkAdaptive: true,
  smallFileThreshold: 100 * 1024 * 1024, // 100MB
  largeFileThreshold: 1024 * 1024 * 1024, // 1GB
};

// 初始状态
const initialState: DownloadState = {
  downloadTasks: [],
  isNetworkOffline: false,
  networkType: NetworkType.UNKNOWN,
  activeDownloads: 0,
  completedDownloads: 0,
  failedDownloads: 0,
  pausedDownloads: 0,
  totalProgress: 0,
  batchInfo: null,
  config: DEFAULT_CONFIG,
  isDownloading: false,
  isMerging: false,
  progressMap: {},
  messageApi: null,
};

// 定义Store类型
type DownloadStore = DownloadState & {
  // 初始化设置
  initSettings: () => void;
  setMessageApi: (api: typeof message) => void;
  getMessageApi: () => typeof message;

  // 任务管理
  addDownloadTask: (params: AddDownloadTaskParams) => Promise<string>;
  removeDownloadTask: (taskId: string) => Promise<boolean>;
  getDownloadTask: (taskId: string) => DownloadTask | undefined;
  updateDownloadTask: (
    taskId: string,
    updates: Partial<DownloadTask>
  ) => Promise<boolean>;

  // 下载操作
  startDownload: (taskId: string) => Promise<boolean>;
  pauseDownload: (taskId: string) => Promise<boolean>;
  resumeDownload: (taskId: string) => Promise<boolean>;
  cancelDownload: (taskId: string) => Promise<boolean>;
  retryDownload: (taskId: string) => Promise<boolean>;
  startBatchDownload: (taskIds: string[]) => Promise<boolean>;
  pauseAllDownloads: () => Promise<boolean>;
  resumeAllDownloads: () => Promise<boolean>;
  cancelAllDownloads: () => Promise<boolean>;
  clearCompletedDownloads: () => Promise<boolean>;

  // 进度更新
  updateProgress: (taskId: string, progress: number) => void;
  updateBatchInfo: (batchInfo: BatchInfo | null) => void;

  // 配置管理
  getConfig: () => DownloadConfig;
  updateConfig: (config: Partial<DownloadConfig>) => void;

  // 存储管理
  getStorageUsage: () => Promise<StorageUsage>;
  cleanupStorage: () => Promise<boolean>;

  // 网络状态
  updateNetworkStatus: (isOffline: boolean, type: NetworkType) => void;

  // 状态更新
  setIsDownloading: (isDownloading: boolean) => void;
  setIsMerging: (isMerging: boolean) => void;
  refreshTasks: () => Promise<DownloadTask[]>;
};

export const useDownloadStore = create<DownloadStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // 初始化设置
        initSettings: () => {
          // 从本地存储加载设置
          const savedConfig = localStorage.getItem("downloadConfig");
          if (savedConfig) {
            try {
              const parsedConfig = JSON.parse(savedConfig);
              set({ config: { ...DEFAULT_CONFIG, ...parsedConfig } });
            } catch (e) {
              console.error("Failed to parse saved config:", e);
            }
          }

          // 初始化消息API
          if (!get().messageApi) {
            set({ messageApi: message });
          }
        },

        setMessageApi: (api) => {
          set({ messageApi: api });
        },

        getMessageApi: () => {
          return get().messageApi || message;
        },

        // 任务管理
        addDownloadTask: async (params) => {
          const { downloadTasks } = get();

          // 检查是否已存在相同URL的任务
          const existingTask = downloadTasks.find(
            (task) => task.url === params.url
          );
          if (existingTask) {
            // 如果任务已完成或失败，可以重新下载
            if (
              existingTask.status === DownloadStatus.COMPLETED ||
              existingTask.status === DownloadStatus.FAILED
            ) {
              // 重置任务状态
              await get().updateDownloadTask(existingTask.id, {
                status: DownloadStatus.QUEUED,
                progress: 0,
                error: undefined,
                retryCount: 0,
              });
              return existingTask.id;
            }

            // 如果任务正在下载或排队中，返回已存在的任务ID
            return existingTask.id;
          }

          // 如果未提供文件大小，尝试获取
          let fileSize = params.fileSize;
          let mimeType = params.mimeType;

          if (!fileSize || !mimeType) {
            try {
              const response = await fetch(params.url, { method: "HEAD" });
              if (response.ok) {
                const contentLength = response.headers.get("content-length");
                if (contentLength && !fileSize) {
                  fileSize = parseInt(contentLength, 10);
                }

                const contentType = response.headers.get("content-type");
                if (contentType && !mimeType) {
                  mimeType = contentType;
                }
              }
            } catch (error) {
              console.error("Failed to fetch file info:", error);
            }
          }

          // 创建新任务
          const newTask: DownloadTask = {
            id: uuidv4(),
            url: params.url,
            fileName: params.fileName,
            fileSize: fileSize || 0,
            mimeType: mimeType || "application/octet-stream",
            status: DownloadStatus.QUEUED,
            progress: 0,
            chunks: [],
            createdAt: Date.now(),
            retryCount: 0,
            priority: params.priority || 0,
            speed: 0,
            resumeSupported: true, // 默认假设支持断点续传，后续会验证
            metadata: params.metadata || {},
          };

          // 更新状态
          set((state) => ({
            downloadTasks: [...state.downloadTasks, newTask],
          }));

          // 如果配置了自动开始下载，则立即开始
          if (get().config.autoStart) {
            get().startDownload(newTask.id);
          }

          return newTask.id;
        },

        removeDownloadTask: async (taskId) => {
          const { downloadTasks } = get();
          const taskIndex = downloadTasks.findIndex(
            (task) => task.id === taskId
          );

          if (taskIndex === -1) {
            return false;
          }

          // 如果任务正在下载，先取消下载
          const task = downloadTasks[taskIndex];
          if (task.status === DownloadStatus.DOWNLOADING) {
            await get().cancelDownload(taskId);
          }

          // 移除任务
          set((state) => ({
            downloadTasks: state.downloadTasks.filter(
              (task) => task.id !== taskId
            ),
          }));

          // 清理相关存储
          try {
            // 从IndexedDB中删除任务数据
            const db = await indexedDB.open("zustand-file-download", 1);
            db.onupgradeneeded = () => {
              const store = db.result.createObjectStore("downloads", {
                keyPath: "id",
              });
              store.createIndex("taskId", "taskId", { unique: false });
            };

            db.onsuccess = () => {
              const transaction = db.result.transaction(
                ["downloads"],
                "readwrite"
              );
              const store = transaction.objectStore("downloads");
              const index = store.index("taskId");

              const request = index.openCursor(IDBKeyRange.only(taskId));
              request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                  cursor.delete();
                  cursor.continue();
                }
              };

              transaction.oncomplete = () => {
                db.result.close();
              };
            };
          } catch (error) {
            console.error("Failed to clean up task data:", error);
          }

          return true;
        },

        getDownloadTask: (taskId) => {
          return get().downloadTasks.find((task) => task.id === taskId);
        },

        updateDownloadTask: async (taskId, updates) => {
          const { downloadTasks } = get();
          const taskIndex = downloadTasks.findIndex(
            (task) => task.id === taskId
          );

          if (taskIndex === -1) {
            return false;
          }

          // 更新任务
          const updatedTask = { ...downloadTasks[taskIndex], ...updates };
          const newTasks = [...downloadTasks];
          newTasks[taskIndex] = updatedTask;

          // 更新状态
          set({ downloadTasks: newTasks });

          // 更新统计信息
          get().refreshTasks();

          return true;
        },

        // 下载操作
        startDownload: async (taskId) => {
          const task = get().getDownloadTask(taskId);
          if (!task) {
            return false;
          }

          // 检查网络状态
          if (get().isNetworkOffline) {
            get().getMessageApi().error("网络已断开，无法开始下载");
            return false;
          }

          // 更新任务状态
          await get().updateDownloadTask(taskId, {
            status: DownloadStatus.PREPARING,
            startedAt: Date.now(),
          });

          // 设置正在下载标志
          set({ isDownloading: true });

          // 实际下载逻辑会由useBatchDownloader钩子处理
          // 这里只是更新状态和触发事件

          return true;
        },

        pauseDownload: async (taskId) => {
          const task = get().getDownloadTask(taskId);
          if (!task || task.status !== DownloadStatus.DOWNLOADING) {
            return false;
          }

          // 更新任务状态
          await get().updateDownloadTask(taskId, {
            status: DownloadStatus.PAUSED,
          });

          // 实际暂停逻辑会由Worker处理

          // 更新统计信息
          set((state) => ({
            pausedDownloads: state.pausedDownloads + 1,
            activeDownloads: state.activeDownloads - 1,
          }));

          return true;
        },

        resumeDownload: async (taskId) => {
          const task = get().getDownloadTask(taskId);
          if (!task || task.status !== DownloadStatus.PAUSED) {
            return false;
          }

          // 检查网络状态
          if (get().isNetworkOffline) {
            get().getMessageApi().error("网络已断开，无法恢复下载");
            return false;
          }

          // 更新任务状态
          await get().updateDownloadTask(taskId, {
            status: DownloadStatus.DOWNLOADING,
          });

          // 实际恢复逻辑会由Worker处理

          // 更新统计信息
          set((state) => ({
            pausedDownloads: state.pausedDownloads - 1,
            activeDownloads: state.activeDownloads + 1,
          }));

          return true;
        },

        cancelDownload: async (taskId) => {
          const task = get().getDownloadTask(taskId);
          if (!task) {
            return false;
          }

          // 更新任务状态
          await get().updateDownloadTask(taskId, {
            status: DownloadStatus.CANCELED,
          });

          // 实际取消逻辑会由Worker处理

          // 更新统计信息
          if (task.status === DownloadStatus.DOWNLOADING) {
            set((state) => ({
              activeDownloads: state.activeDownloads - 1,
            }));
          } else if (task.status === DownloadStatus.PAUSED) {
            set((state) => ({
              pausedDownloads: state.pausedDownloads - 1,
            }));
          }

          return true;
        },

        retryDownload: async (taskId) => {
          const task = get().getDownloadTask(taskId);
          if (
            !task ||
            (task.status !== DownloadStatus.FAILED &&
              task.status !== DownloadStatus.MERGE_ERROR)
          ) {
            return false;
          }

          // 检查网络状态
          if (get().isNetworkOffline) {
            get().getMessageApi().error("网络已断开，无法重试下载");
            return false;
          }

          // 更新任务状态
          await get().updateDownloadTask(taskId, {
            status: DownloadStatus.QUEUED,
            progress: 0,
            error: undefined,
            retryCount: task.retryCount + 1,
          });

          // 开始下载
          return get().startDownload(taskId);
        },

        startBatchDownload: async (taskIds) => {
          // 检查网络状态
          if (get().isNetworkOffline) {
            get().getMessageApi().error("网络已断开，无法开始批量下载");
            return false;
          }

          // 过滤出可下载的任务
          const validTaskIds = taskIds.filter((taskId) => {
            const task = get().getDownloadTask(taskId);
            return (
              task &&
              (task.status === DownloadStatus.QUEUED ||
                task.status === DownloadStatus.FAILED ||
                task.status === DownloadStatus.MERGE_ERROR)
            );
          });

          if (validTaskIds.length === 0) {
            get().getMessageApi().info("没有可下载的任务");
            return false;
          }

          // 初始化批次信息
          const batchInfo: BatchInfo = {
            current: 0,
            total: validTaskIds.length,
            queued: validTaskIds.length,
            active: 0,
            completed: 0,
            failed: 0,
            retried: 0,
          };

          set({
            batchInfo,
            isDownloading: true,
          });

          // 实际批量下载逻辑会由useBatchDownloader钩子处理
          // 这里只是更新状态和触发事件

          return true;
        },

        pauseAllDownloads: async () => {
          const { downloadTasks } = get();
          const downloadingTasks = downloadTasks.filter(
            (task) => task.status === DownloadStatus.DOWNLOADING
          );

          if (downloadingTasks.length === 0) {
            return false;
          }

          // 暂停所有正在下载的任务
          const promises = downloadingTasks.map((task) =>
            get().pauseDownload(task.id)
          );
          await Promise.all(promises);

          return true;
        },

        resumeAllDownloads: async () => {
          // 检查网络状态
          if (get().isNetworkOffline) {
            get().getMessageApi().error("网络已断开，无法恢复下载");
            return false;
          }

          const { downloadTasks } = get();
          const pausedTasks = downloadTasks.filter(
            (task) => task.status === DownloadStatus.PAUSED
          );

          if (pausedTasks.length === 0) {
            return false;
          }

          // 恢复所有暂停的任务
          const promises = pausedTasks.map((task) =>
            get().resumeDownload(task.id)
          );
          await Promise.all(promises);

          return true;
        },

        cancelAllDownloads: async () => {
          const { downloadTasks } = get();
          const activeTasks = downloadTasks.filter(
            (task) =>
              task.status === DownloadStatus.DOWNLOADING ||
              task.status === DownloadStatus.PAUSED
          );

          if (activeTasks.length === 0) {
            return false;
          }

          // 取消所有活跃的任务
          const promises = activeTasks.map((task) =>
            get().cancelDownload(task.id)
          );
          await Promise.all(promises);

          // 清除批次信息
          set({ batchInfo: null });

          return true;
        },

        clearCompletedDownloads: async () => {
          const { downloadTasks } = get();
          const completedTasks = downloadTasks.filter(
            (task) => task.status === DownloadStatus.COMPLETED
          );

          if (completedTasks.length === 0) {
            return false;
          }

          // 移除所有已完成的任务
          const promises = completedTasks.map((task) =>
            get().removeDownloadTask(task.id)
          );
          await Promise.all(promises);

          // 更新统计信息
          set((state) => ({
            completedDownloads:
              state.completedDownloads - completedTasks.length,
          }));

          return true;
        },

        // 进度更新
        updateProgress: (taskId, progress) => {
          set((state) => ({
            progressMap: {
              ...state.progressMap,
              [taskId]: progress,
            },
          }));

          // 更新任务进度
          const task = get().getDownloadTask(taskId);
          if (task) {
            get().updateDownloadTask(taskId, { progress });
          }

          // 计算总体进度
          const tasks = get().downloadTasks;
          const activeTasks = tasks.filter(
            (task) =>
              task.status === DownloadStatus.DOWNLOADING ||
              task.status === DownloadStatus.MERGING
          );

          if (activeTasks.length > 0) {
            const totalProgress =
              activeTasks.reduce((sum, task) => sum + task.progress, 0) /
              activeTasks.length;

            set({ totalProgress });
          }
        },

        updateBatchInfo: (batchInfo) => {
          set({ batchInfo });
        },

        // 配置管理
        getConfig: () => {
          return get().config;
        },

        updateConfig: (config) => {
          const newConfig = { ...get().config, ...config };
          set({ config: newConfig });

          // 保存到本地存储
          localStorage.setItem("downloadConfig", JSON.stringify(newConfig));
        },

        // 存储管理
        getStorageUsage: async () => {
          // 默认值
          const defaultUsage: StorageUsage = {
            indexedDBUsage: 0,
            fileSystemUsage: 0,
            quota: get().config.storageQuota,
            usagePercentage: 0,
            availableSpace: get().config.storageQuota,
            tasks: [],
          };

          try {
            // 获取IndexedDB使用情况
            // 注意：这里使用的API可能不是所有浏览器都支持
            if (navigator.storage && navigator.storage.estimate) {
              const estimate = await navigator.storage.estimate();
              defaultUsage.quota = estimate.quota || defaultUsage.quota;
              defaultUsage.indexedDBUsage = estimate.usage || 0;
            }

            // 计算每个任务的存储使用情况
            const { downloadTasks } = get();
            for (const task of downloadTasks) {
              if (task.chunks.length > 0) {
                // 估算任务大小
                const taskSize = task.chunks.reduce(
                  (sum, chunk) => sum + (chunk.downloaded || 0),
                  0
                );

                if (taskSize > 0) {
                  defaultUsage.tasks.push({
                    id: task.id,
                    fileName: task.fileName,
                    size: taskSize,
                  });
                }
              }
            }

            // 计算总使用量和百分比
            const totalUsage =
              defaultUsage.indexedDBUsage + defaultUsage.fileSystemUsage;
            defaultUsage.usagePercentage =
              (totalUsage / defaultUsage.quota) * 100;
            defaultUsage.availableSpace = defaultUsage.quota - totalUsage;

            return defaultUsage;
          } catch (error) {
            console.error("Failed to get storage usage:", error);
            return defaultUsage;
          }
        },

        cleanupStorage: async () => {
          try {
            // 清理IndexedDB中的过期数据
            const db = await indexedDB.open("zustand-file-download", 1);
            db.onupgradeneeded = () => {
              const store = db.result.createObjectStore("downloads", {
                keyPath: "id",
              });
              store.createIndex("taskId", "taskId", { unique: false });
              store.createIndex("timestamp", "timestamp", { unique: false });
            };

            db.onsuccess = () => {
              const transaction = db.result.transaction(
                ["downloads"],
                "readwrite"
              );
              const store = transaction.objectStore("downloads");
              const index = store.index("timestamp");

              // 删除30天前的数据
              const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
              const range = IDBKeyRange.upperBound(thirtyDaysAgo);

              const request = index.openCursor(range);
              request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                  cursor.delete();
                  cursor.continue();
                }
              };

              transaction.oncomplete = () => {
                db.result.close();
              };
            };

            // 清理已完成的下载任务
            await get().clearCompletedDownloads();

            return true;
          } catch (error) {
            console.error("Failed to clean up storage:", error);
            return false;
          }
        },

        // 网络状态
        updateNetworkStatus: (isOffline, type) => {
          set({
            isNetworkOffline: isOffline,
            networkType: type,
          });

          // 如果网络断开，暂停所有下载
          if (isOffline) {
            get().pauseAllDownloads();
          }
        },

        // 状态更新
        setIsDownloading: (isDownloading) => {
          set({ isDownloading });
        },

        setIsMerging: (isMerging) => {
          set({ isMerging });
        },

        refreshTasks: async () => {
          const { downloadTasks } = get();

          // 计算各种状态的任务数量
          let activeCount = 0;
          let completedCount = 0;
          let failedCount = 0;
          let pausedCount = 0;

          for (const task of downloadTasks) {
            if (
              task.status === DownloadStatus.DOWNLOADING ||
              task.status === DownloadStatus.MERGING
            ) {
              activeCount++;
            } else if (task.status === DownloadStatus.COMPLETED) {
              completedCount++;
            } else if (
              task.status === DownloadStatus.FAILED ||
              task.status === DownloadStatus.MERGE_ERROR
            ) {
              failedCount++;
            } else if (task.status === DownloadStatus.PAUSED) {
              pausedCount++;
            }
          }

          // 更新统计信息
          set({
            activeDownloads: activeCount,
            completedDownloads: completedCount,
            failedDownloads: failedCount,
            pausedDownloads: pausedCount,
          });

          // 如果没有活跃的下载，设置isDownloading为false
          if (activeCount === 0) {
            set({ isDownloading: false });
          }

          return downloadTasks;
        },
      }),
      {
        name: "zustand-file-download-store",
        partialize: (state) => ({
          config: state.config,
          downloadTasks: state.downloadTasks,
        }),
      }
    )
  )
);

// 初始化store
useDownloadStore.getState().initSettings();
