const ctx: Worker = self as any;

const activeDownloads: Record<string, boolean> = {};
const processedFiles = new Set<string>();
const retryAttempts: Record<string, number> = {};
const chunkRetryAttempts: Record<string, number> = {};
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;
const PROGRESS_UPDATE_INTERVAL = 500;
const lastProgressUpdate: Record<string, number> = {};
const lastProgressValue: Record<string, number> = {};
const PROGRESS_CHANGE_THRESHOLD = 3;

const DEFAULT_CHUNK_CONCURRENCY = 3;

const fileConcurrencySettings: Record<string, number> = {};
const chunkConcurrencySettings: Record<string, number> = {};

ctx.addEventListener("message", async (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case "START_DOWNLOAD":
      handleDownload(payload);
      break;
    case "PAUSE_DOWNLOAD":
      handlePause(payload);
      break;
    case "RESUME_DOWNLOAD":
      handleResume(payload);
      break;
    case "CANCEL":
      handleCancel(payload);
      break;
    case "UPDATE_CONCURRENCY":
      handleUpdateConcurrency(payload);
      break;
    default:
      console.error("未知的Worker消息类型:", type);
  }
});

function handleUpdateConcurrency(payload: {
  fileId?: string;
  fileConcurrency?: number;
  chunkConcurrency?: number;
}) {
  const { fileId, fileConcurrency, chunkConcurrency } = payload;

  if (fileId) {
    if (fileConcurrency !== undefined) {
      fileConcurrencySettings[fileId] = fileConcurrency;
    }
    if (chunkConcurrency !== undefined) {
      chunkConcurrencySettings[fileId] = chunkConcurrency;
    }
  }
}

function getChunkConcurrency(fileId: string): number {
  return chunkConcurrencySettings[fileId] || DEFAULT_CHUNK_CONCURRENCY;
}

async function handleDownload(payload: {
  fileId: string;
  url: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  pendingChunks: number[];
  fileConcurrency?: number;
  chunkConcurrency?: number;
}) {
  const {
    fileId,
    url,
    fileSize,
    chunkSize,
    totalChunks,
    pendingChunks,
    fileConcurrency,
    chunkConcurrency,
  } = payload;

  if (fileConcurrency !== undefined) {
    fileConcurrencySettings[fileId] = fileConcurrency;
  }
  if (chunkConcurrency !== undefined) {
    chunkConcurrencySettings[fileId] = chunkConcurrency;
  }

  const isFirstDownload = !processedFiles.has(fileId);

  activeDownloads[fileId] = true;
  processedFiles.add(fileId);
  retryAttempts[fileId] = 0;
  lastProgressUpdate[fileId] = 0;

  pendingChunks.forEach((chunkIndex) => {
    const chunkId = `${fileId}_${chunkIndex}`;
    chunkRetryAttempts[chunkId] = 0;
  });

  const maxConcurrent = isFirstDownload ? 1 : getChunkConcurrency(fileId);

  let downloadedChunks = totalChunks - pendingChunks.length;
  let remainingChunks = [...pendingChunks];

  sendProgressUpdate(fileId, downloadedChunks, totalChunks);

  while (remainingChunks.length > 0 && activeDownloads[fileId]) {
    if (!activeDownloads[fileId]) {
      return;
    }

    const currentBatch = remainingChunks.splice(0, maxConcurrent);

    const chunkPromises = currentBatch.map((chunkIndex) =>
      downloadChunk(fileId, url, chunkIndex, fileSize, chunkSize)
    );

    const results = await Promise.all(chunkPromises);

    if (!activeDownloads[fileId]) {
      return;
    }

    const successfulDownloads = results.filter((r) => r.success).length;
    downloadedChunks += successfulDownloads;

    sendProgressUpdate(fileId, downloadedChunks, totalChunks);

    const failedChunks = results
      .filter((r) => !r.success && !r.paused)
      .map((r) => r.chunkIndex);

    if (failedChunks.length > 0) {
      retryAttempts[fileId] = (retryAttempts[fileId] || 0) + 1;

      console.warn(
        `文件 ${fileId} 下载重试 ${retryAttempts[fileId]}/${MAX_RETRY_ATTEMPTS}`
      );

      if (retryAttempts[fileId] >= MAX_RETRY_ATTEMPTS) {
        console.warn(`文件 ${fileId} 下载失败次数过多，暂停下载`);
        activeDownloads[fileId] = false;

        ctx.postMessage({
          type: "ERROR",
          payload: {
            fileId,
            chunkIndex: failedChunks[0],
            error: `下载失败次数过多（${retryAttempts[fileId]}次），请检查网络连接后重试`,
          },
        });

        return;
      }

      const allChunksExceededRetries = failedChunks.every((chunkIndex) => {
        const chunkId = `${fileId}_${chunkIndex}`;
        return chunkRetryAttempts[chunkId] >= MAX_RETRY_ATTEMPTS;
      });

      if (allChunksExceededRetries) {
        console.warn(`文件 ${fileId} 的所有分片都已达到最大重试次数，停止下载`);
        activeDownloads[fileId] = false;

        ctx.postMessage({
          type: "ERROR",
          payload: {
            fileId,
            chunkIndex: failedChunks[0],
            error: `多个分片下载失败，请检查网络连接后重试`,
          },
        });

        return;
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }

    const retriableChunks = failedChunks.filter((chunkIndex) => {
      const chunkId = `${fileId}_${chunkIndex}`;
      return chunkRetryAttempts[chunkId] < MAX_RETRY_ATTEMPTS;
    });

    remainingChunks = [...remainingChunks, ...retriableChunks];

    if (remainingChunks.length === 0) {
      sendProgressUpdate(fileId, totalChunks, totalChunks, true);

      ctx.postMessage({
        type: "COMPLETE",
        payload: {
          fileId,
          downloadedChunks,
        },
      });
    }

    await new Promise((resolve) =>
      setTimeout(resolve, isFirstDownload ? 100 : 10)
    );
  }
}

function sendProgressUpdate(
  fileId: string,
  downloadedChunks: number,
  totalChunks: number,
  forceUpdate = false
) {
  const now = Date.now();
  const progress = Math.round((downloadedChunks / totalChunks) * 100);

  const lastProgress = lastProgressValue[fileId] ?? -1;

  const progressChange = Math.abs(progress - lastProgress);

  if (
    forceUpdate ||
    progress === 0 ||
    progress === 100 ||
    progressChange >= PROGRESS_CHANGE_THRESHOLD ||
    now - (lastProgressUpdate[fileId] || 0) >= PROGRESS_UPDATE_INTERVAL
  ) {
    ctx.postMessage({
      type: "PROGRESS",
      payload: {
        fileId,
        progress,
        downloadedChunks,
      },
    });

    lastProgressUpdate[fileId] = now;
    lastProgressValue[fileId] = progress;
  }
}

async function downloadChunk(
  fileId: string,
  url: string,
  chunkIndex: number,
  fileSize: number,
  chunkSize: number
) {
  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize - 1, fileSize - 1);
  const chunkId = `${fileId}_${chunkIndex}`;

  const actualChunkSize = end - start + 1;
  console.debug(
    `下载分片 ${chunkIndex}: 范围 ${start}-${end}, 大小: ${actualChunkSize}字节`
  );

  chunkRetryAttempts[chunkId] = (chunkRetryAttempts[chunkId] || 0) + 1;

  if (chunkRetryAttempts[chunkId] > MAX_RETRY_ATTEMPTS) {
    console.error(
      `分片 ${chunkIndex} 已达到最大重试次数 ${MAX_RETRY_ATTEMPTS}`
    );
    return {
      success: false,
      chunkIndex,
      error: `达到最大重试次数 ${MAX_RETRY_ATTEMPTS}`,
    };
  }

  try {
    if (!activeDownloads[fileId]) {
      return { success: false, chunkIndex, paused: true };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!activeDownloads[fileId]) {
        return { success: false, chunkIndex, paused: true };
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        throw new Error(`分片 ${chunkIndex} 下载完成，但大小为0字节`);
      }

      ctx.postMessage({
        type: "CHUNK_DOWNLOADED",
        payload: {
          fileId,
          chunkIndex,
          blob,
          size: blob.size,
        },
      });

      chunkRetryAttempts[chunkId] = 0;

      return {
        success: true,
        chunkIndex,
        size: blob.size,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        console.error(`下载分片 ${chunkIndex} 超时`);
        throw new Error(`下载超时`);
      }

      throw error;
    }
  } catch (err) {
    const error = err as Error;
    console.error(
      `下载分片 ${chunkIndex} 失败 (尝试 ${chunkRetryAttempts[chunkId]}/${MAX_RETRY_ATTEMPTS}):`,
      error
    );

    return {
      success: false,
      chunkIndex,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

function handlePause(payload: { fileId: string }) {
  const { fileId } = payload;

  activeDownloads[fileId] = false;

  setTimeout(() => {
    ctx.postMessage({
      type: "PAUSED",
      payload: { fileId },
    });
  }, 100);
}

function handleResume(payload: { fileId: string }) {
  const { fileId } = payload;
  activeDownloads[fileId] = true;

  ctx.postMessage({
    type: "RESUMED",
    payload: { fileId },
  });
}

function handleCancel(payload: { fileId: string }) {
  const { fileId } = payload;
  activeDownloads[fileId] = false;

  ctx.postMessage({
    type: "CANCELLED",
    payload: { fileId },
  });
}

export {};
