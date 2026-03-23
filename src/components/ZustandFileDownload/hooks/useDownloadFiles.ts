import { DownloadFile, DownloadStatus } from "../types";
import { useCallback, useEffect, useRef } from "react";

import { chunkStore } from "../utils";
import { completeFileStore } from "../utils";
import { fileStore } from "../utils";
import { message } from "antd";
import { useDownloadStore } from "../store";
import { useStorageManager } from "./useStorageManager";
import { useShallow } from "zustand/react/shallow";

const CHUNK_KEY_MARKER = "_chunk_";

const calculateProgress = (downloadedChunks: number, totalChunks: number) => {
  if (totalChunks <= 0) {
    return 0;
  }

  return Math.round((downloadedChunks / totalChunks) * 100);
};

const clampDownloadedChunks = (downloadedChunks: number, totalChunks: number) =>
  Math.min(Math.max(downloadedChunks, 0), Math.max(totalChunks, 0));

export const useDownloadFiles = () => {
  const { files, fetchingFiles, setFiles, fetchDownloadFiles } = useDownloadStore(
    useShallow((state) => ({
      files: state.files,
      fetchingFiles: state.fetchingFiles,
      setFiles: state.setFiles,
      fetchDownloadFiles: state.fetchDownloadFiles,
    }))
  );

  const { triggerStorageUpdate } = useStorageManager();

  const prevState = useRef({
    totalFiles: 0,
    completedFiles: 0,
    downloadingFiles: 0,
    lastUpdateTime: 0,
    chunkSize: 0,
    isInitialized: false,
  });

  const updateLocalFileStatus = useCallback(
    async (currentFiles?: DownloadFile[]) => {
      try {
        const filesToProcess = currentFiles ?? useDownloadStore.getState().files;

        if (!filesToProcess || filesToProcess.length === 0) {
          return;
        }

        const localFiles: Record<string, DownloadFile> = {};
        const keys = await fileStore.keys();
        if (keys.length === 0) {
          return;
        }

        const storedFileEntries = (
          await Promise.all(
            keys.map(async (key) => {
              const storedFile = await fileStore.getItem<DownloadFile>(key);
              return [key, storedFile] as const;
            })
          )
        ).filter((entry): entry is readonly [string, DownloadFile] => Boolean(entry[1]));

        if (storedFileEntries.length === 0) {
          return;
        }

        const requiresChunkSnapshot = storedFileEntries.some(([, storedFile]) => {
          if (storedFile.status === DownloadStatus.DOWNLOADING) {
            return true;
          }

          return (
            storedFile.status === DownloadStatus.PAUSED &&
            (storedFile.progress === undefined || storedFile.progress === null) &&
            (storedFile.downloadedChunks === undefined ||
              storedFile.downloadedChunks === null)
          );
        });

        const downloadedChunkCountByFileId = new Map<string, number>();
        if (requiresChunkSnapshot) {
          await chunkStore.ready();
          const chunkKeys = await chunkStore.keys();
          for (const chunkKey of chunkKeys) {
            const markerIndex = chunkKey.lastIndexOf(CHUNK_KEY_MARKER);
            if (markerIndex <= 0) {
              continue;
            }

            const fileId = chunkKey.slice(0, markerIndex);
            downloadedChunkCountByFileId.set(
              fileId,
              (downloadedChunkCountByFileId.get(fileId) ?? 0) + 1
            );
          }
        }

        const requiresCompleteSnapshot = storedFileEntries.some(
          ([, storedFile]) =>
            storedFile.status === DownloadStatus.PAUSED && storedFile.progress === 100
        );

        const completedFileIdSet = new Set<string>();
        if (requiresCompleteSnapshot) {
          await completeFileStore.ready();
          const completeFileKeys = await completeFileStore.keys();
          for (const completeFileKey of completeFileKeys) {
            completedFileIdSet.add(completeFileKey);
          }
        }

        const persistenceTasks: Array<Promise<unknown>> = [];

        for (const [, storedFile] of storedFileEntries) {
          let nextStoredFile: DownloadFile = storedFile;
          let shouldPersist = false;

          const totalChunks = Math.max(nextStoredFile.totalChunks ?? 0, 0);
          const snapshotChunkCount = clampDownloadedChunks(
            downloadedChunkCountByFileId.get(nextStoredFile.id) ?? 0,
            totalChunks
          );

          if (nextStoredFile.status === DownloadStatus.DOWNLOADING) {
            nextStoredFile = {
              ...nextStoredFile,
              status: DownloadStatus.PAUSED,
              downloadedChunks: snapshotChunkCount,
              progress: calculateProgress(snapshotChunkCount, totalChunks),
            };
            shouldPersist = true;
          }

          if (
            nextStoredFile.status === DownloadStatus.PAUSED &&
            nextStoredFile.progress === 100 &&
            completedFileIdSet.has(nextStoredFile.id)
          ) {
            nextStoredFile = {
              ...nextStoredFile,
              status: DownloadStatus.COMPLETED,
              completedAt: nextStoredFile.completedAt || Date.now(),
            };
            shouldPersist = true;
          }

          if (
            nextStoredFile.status === DownloadStatus.PAUSED &&
            (nextStoredFile.progress === undefined || nextStoredFile.progress === null)
          ) {
            const downloadedChunksFromState =
              nextStoredFile.downloadedChunks ?? snapshotChunkCount;
            const downloadedChunks = clampDownloadedChunks(
              downloadedChunksFromState,
              totalChunks
            );

            nextStoredFile = {
              ...nextStoredFile,
              downloadedChunks,
              progress: calculateProgress(downloadedChunks, totalChunks),
            };
            shouldPersist = true;
          }

          if (shouldPersist) {
            persistenceTasks.push(fileStore.setItem(nextStoredFile.id, nextStoredFile));
          }

          localFiles[nextStoredFile.id] = nextStoredFile;
        }

        if (persistenceTasks.length > 0) {
          await Promise.all(persistenceTasks);
        }

        const updatedFiles = filesToProcess.map((file: DownloadFile) => {
          const localFile = localFiles[file.id];
          if (!localFile) {
            return file;
          }

          return {
            ...file,
            downloadedChunks: localFile.downloadedChunks || 0,
            progress: localFile.progress || 0,
            status: localFile.status || DownloadStatus.IDLE,
            error: localFile.error,
            completedAt: localFile.completedAt,
          };
        });

        setFiles(updatedFiles);
      } catch (error) {
        console.error("Failed to update local file status:", error);
      }
    },
    [setFiles]
  );

  const fetchFileList = useCallback(
    async (forceUpdate = false) => {
      try {
        const downloadedFiles = await fetchDownloadFiles({}, forceUpdate);

        if (downloadedFiles && downloadedFiles.length > 0) {
          await updateLocalFileStatus(downloadedFiles);
        }

        if (!prevState.current.isInitialized) {
          triggerStorageUpdate();
          prevState.current.isInitialized = true;
        }
      } catch (error) {
        console.error("获取文件列表失败:", error);
        message.error("获取文件列表失败，请检查网络连接。");
      }
    },
    [fetchDownloadFiles, triggerStorageUpdate, updateLocalFileStatus]
  );

  useEffect(() => {
    fetchFileList(true);
  }, [fetchFileList]);

  useEffect(() => {
    if (!files || files.length === 0) return;

    const completedFiles = files.filter(
      (file) => file.status === DownloadStatus.COMPLETED
    ).length;
    const downloadingFiles = files.filter(
      (file) => file.status === DownloadStatus.DOWNLOADING
    ).length;

    const hasSignificantChanges =
      prevState.current.totalFiles !== files.length ||
      prevState.current.completedFiles !== completedFiles ||
      Math.abs(prevState.current.downloadingFiles - downloadingFiles) > 1;

    if (hasSignificantChanges) {
      triggerStorageUpdate();
      prevState.current = {
        ...prevState.current,
        totalFiles: files.length,
        completedFiles,
        downloadingFiles,
        lastUpdateTime: Date.now(),
      };
    }
  }, [files, triggerStorageUpdate]);

  useEffect(() => {
    const initialChunkSize = useDownloadStore.getState().chunkSize;
    prevState.current.chunkSize = initialChunkSize;

    const unsubscribe = useDownloadStore.subscribe((state) => {
      const currentChunkSize = state.chunkSize;
      const prevChunkSize = prevState.current.chunkSize;

      if (prevChunkSize !== 0 && prevChunkSize !== currentChunkSize) {
        prevState.current.chunkSize = currentChunkSize;
        fetchFileList(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [fetchFileList]);

  return {
    files,
    fetchingFiles,
    fetchFileList,
  };
};
