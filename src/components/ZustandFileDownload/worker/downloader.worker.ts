import type { StartDownloadPayload } from "../types/download";
import { debugError, debugWarn, debugLog } from "./../../../shared/debugLogger";

const ctx: Worker = self as unknown as Worker;
type WorkerEnvelope = { type: string; payload: unknown };

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
// 每个文件的鉴权设置（随 START_DOWNLOAD 下发，取消/完成后清理，避免 token 残留）
const downloadAuthSettings: Record<
  string,
  { authHeaders?: Record<string, string>; withCredentials?: boolean }
> = {};

ctx.addEventListener("message", async (event: MessageEvent<WorkerEnvelope>) => {
  const { type, payload } = event.data;

  switch (type) {
    case "START_DOWNLOAD":
      handleDownload(payload as StartDownloadPayload);
      break;
    case "PAUSE_DOWNLOAD":
      handlePause(payload as { fileId: string });
      break;
    case "RESUME_DOWNLOAD":
      handleResume(payload as { fileId: string });
      break;
    case "CANCEL":
      handleCancel(payload as { fileId: string });
      break;
    case "UPDATE_CONCURRENCY":
      handleUpdateConcurrency(
        payload as {
          fileId?: string;
          fileConcurrency?: number;
          chunkConcurrency?: number;
        }
      );
      break;
    default:
      debugError("未知的Worker消息类型:", type);
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

async function handleDownload(payload: StartDownloadPayload) {
  const {
    fileId,
    url,
    fileSize,
    chunkSize,
    totalChunks,
    pendingChunks,
    fileConcurrency,
    chunkConcurrency,
    authHeaders,
    withCredentials,
  } = payload;

  if (fileConcurrency !== undefined) {
    fileConcurrencySettings[fileId] = fileConcurrency;
  }
  if (chunkConcurrency !== undefined) {
    chunkConcurrencySettings[fileId] = chunkConcurrency;
  }
  // 记录该文件的鉴权设置，供分片请求合并（取消/下次启动时覆盖或清理）
  downloadAuthSettings[fileId] = { authHeaders, withCredentials };

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

    if (failedChunks.length === 0) {
      // F8：整批全部成功后清空累计失败计数，使得"早期偶发失败 + 后续恢复正常"
      // 不会让 retryAttempts 单调递增，最终被误判为"失败次数过多"而中止整文件。
      // 只有连续失败（中间无任何干净批次）才会累加。
      retryAttempts[fileId] = 0;
    } else {
      retryAttempts[fileId] = (retryAttempts[fileId] || 0) + 1;

      debugWarn(
        `文件 ${fileId} 下载重试 ${retryAttempts[fileId]}/${MAX_RETRY_ATTEMPTS}`
      );

      // F8 off-by-one：用 `>` 而非 `>=`，使得恰好 MAX_RETRY_ATTEMPTS 次失败时
      // 仍会再重试一次；仅第 MAX_RETRY_ATTEMPTS+1 次失败才判定为"过多"并中止。
      // （与分片级 chunkRetryAttempts 的 `>` 守卫保持一致。）
      if (retryAttempts[fileId] > MAX_RETRY_ATTEMPTS) {
        debugWarn(`文件 ${fileId} 下载失败次数过多，暂停下载`);
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
        // F8：与分片级重试上限对齐，需达到 MAX_RETRY_ATTEMPTS+1 次失败才算"超限"。
        return (chunkRetryAttempts[chunkId] ?? 0) >= MAX_RETRY_ATTEMPTS + 1;
      });

      if (allChunksExceededRetries) {
        debugWarn(`文件 ${fileId} 的所有分片都已达到最大重试次数，停止下载`);
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
      // F8：分片级重试上限与 MAX_RETRY_ATTEMPTS 语义对齐（允许 MAX_RETRY_ATTEMPTS
      // 次重试，即 MAX_RETRY_ATTEMPTS+1 次尝试）。
      return (chunkRetryAttempts[chunkId] ?? 0) < MAX_RETRY_ATTEMPTS + 1;
    });

    remainingChunks = [...remainingChunks, ...retriableChunks];

    if (remainingChunks.length === 0) {
      sendProgressUpdate(fileId, totalChunks, totalChunks, true);
      // 下载完成，清理该文件的鉴权设置
      delete downloadAuthSettings[fileId];

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
  debugLog(
    `下载分片 ${chunkIndex}: 范围 ${start}-${end}, 大小: ${actualChunkSize}字节`
  );

  chunkRetryAttempts[chunkId] = (chunkRetryAttempts[chunkId] || 0) + 1;

  // F8：允许 MAX_RETRY_ATTEMPTS 次重试（即 MAX_RETRY_ATTEMPTS+1 次尝试）；
  // 第 MAX_RETRY_ATTEMPTS+2 次调用才放弃（不再发起 fetch）。此前 `> MAX_RETRY_ATTEMPTS`
  // 只允许 3 次尝试，与文件级阈值不一致，且无法容错恰好 3 次偶发失败。
  if (chunkRetryAttempts[chunkId] > MAX_RETRY_ATTEMPTS + 1) {
    debugError(
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

    // 合并鉴权设置：Bearer/自定义头 + credentials（默认 same-origin，
    // 仅 withCredentials:true 时 include，与上传侧语义一致）
    const { authHeaders, withCredentials } = downloadAuthSettings[fileId] ?? {};

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        headers: {
          ...(authHeaders ?? {}),
          Range: `bytes=${start}-${end}`,
        },
        credentials: withCredentials === true ? "include" : "same-origin",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!activeDownloads[fileId]) {
        return { success: false, chunkIndex, paused: true };
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // F4 下载分片完整性：要求 206 Partial Content + 正确的 Content-Range，
      // 并校验返回 blob 体积与期望分片大小一致。代理忽略 Range、返回全量 200
      // 或范围错位时，会静默产出损坏分片，此处一律判失败并触发重试。
      if (response.status !== 206) {
        throw new Error(`expected 206 Partial Content, got ${response.status}`);
      }
      const contentRange = response.headers.get("Content-Range");
      if (!contentRange) {
        throw new Error("missing Content-Range header");
      }
      const crMatch = /^bytes (\d+)-(\d+)\/(?:\d+|\*)$/.exec(contentRange);
      if (!crMatch) {
        throw new Error(`invalid Content-Range: ${contentRange}`);
      }
      const crStart = Number(crMatch[1]);
      const crEnd = Number(crMatch[2]);
      if (crStart !== start || crEnd !== end) {
        throw new Error(
          `Content-Range mismatch: expected ${start}-${end}, got ${crStart}-${crEnd}`
        );
      }

      const blob = await response.blob();

      if (blob.size !== actualChunkSize) {
        throw new Error(
          `chunk ${chunkIndex} size mismatch: expected ${actualChunkSize}, got ${blob.size}`
        );
      }

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
        debugError(`下载分片 ${chunkIndex} 超时`);
        throw new Error(`下载超时`);
      }

      throw error;
    }
  } catch (err) {
    const error = err as Error;
    debugError(
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
  // 清理该文件的鉴权设置，避免 token 在 Worker 内残留
  delete downloadAuthSettings[fileId];

  ctx.postMessage({
    type: "CANCELLED",
    payload: { fileId },
  });
}

export {};
