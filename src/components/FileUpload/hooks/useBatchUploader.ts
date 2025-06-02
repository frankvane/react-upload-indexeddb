import { UploadFile, UploadStatus } from "../types/upload";

import localforage from "localforage";
import { useState } from "react";

const workerUrl = new URL("../worker/uploadWorker.ts", import.meta.url).href;

interface UseBatchUploaderOptions {
  setProgressMap?: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  refreshFiles?: () => void;
}

export function useBatchUploader(options?: UseBatchUploaderOptions) {
  const [batchInfo, setBatchInfo] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const uploadAll = async () => {
    const keys = await localforage.keys();
    setBatchInfo({ current: 0, total: keys.length });
    for (let i = 0; i < keys.length; i++) {
      const data = await localforage.getItem<UploadFile>(keys[i]);
      if (!data || !data.buffer) continue;
      if (options?.setProgressMap)
        options.setProgressMap((prev) => ({ ...prev, [data.id]: 0 }));
      // 上传前，状态设为 UPLOADING
      await localforage.setItem(data.id, {
        ...data,
        status: UploadStatus.UPLOADING,
      });
      if (options?.refreshFiles) options.refreshFiles();
      await new Promise<void>((resolve) => {
        const worker = new Worker(workerUrl);
        worker.postMessage({ fileInfo: data, fileBuffer: data.buffer });
        worker.onmessage = async (e) => {
          if (e.data.type === "progress") {
            if (options?.setProgressMap)
              options.setProgressMap((prev) => ({
                ...prev,
                [data.id]: e.data.progress,
              }));
          } else if (e.data.type === "done") {
            if (options?.setProgressMap)
              options.setProgressMap((prev) => ({ ...prev, [data.id]: 100 }));
            // 上传完成或秒传，状态设为 DONE 或 INSTANT
            const newStatus = e.data.skipped
              ? UploadStatus.INSTANT
              : UploadStatus.DONE;
            await localforage.setItem(data.id, { ...data, status: newStatus });
            if (options?.refreshFiles) options.refreshFiles();
            resolve();
          }
        };
      });
      setBatchInfo({ current: i + 1, total: keys.length });
    }
    setBatchInfo(null);
  };

  return {
    uploadAll,
    batchInfo,
  };
}
