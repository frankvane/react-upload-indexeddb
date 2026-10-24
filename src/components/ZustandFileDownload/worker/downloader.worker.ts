import type { StartDownloadPayload } from "../types/download";
import { debugError, debugWarn, debugLog } from "./../../../shared/debugLogger";
import { isUrlAllowed } from "./../../../shared/urlSafety";

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

/**
 * 解析 `Retry-After` 头（P1：限速信号驱动的退避）。
 * 支持「秒数」（如 "30"）与 HTTP-date 两种格式；无法解析时返回 undefined，
 * 退化为固定 RETRY_DELAY。
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  // 秒数
  if (/^\d+$/.test(trimmed)) {
    const secs = Number(trimmed);
    if (Number.isFinite(secs) && secs > 0) return secs * 1000;
    return undefined;
  }
  // HTTP-date
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

const fileConcurrencySettings: Record<string, number> = {};
const chunkConcurrencySettings: Record<string, number> = {};
// 每个文件的鉴权设置（随 START_DOWNLOAD 下发，取消/完成后清理，避免 token 残留）
const downloadAuthSettings: Record<
  string,
  {
    authHeaders?: Record<string, string>;
    withCredentials?: boolean;
    /** F3：允许携带鉴权头的宿主白名单（SSRF/token 泄漏防护） */
    allowedHosts?: string[];
  }
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
    allowedHosts,
  } = payload;

  if (fileConcurrency !== undefined) {
    fileConcurrencySettings[fileId] = fileConcurrency;
  }
  if (chunkConcurrency !== undefined) {
    chunkConcurrencySettings[fileId] = chunkConcurrency;
  }
  // 记录该文件的鉴权设置，供分片请求合并（取消/下次启动时覆盖或清理）
  downloadAuthSettings[fileId] = { authHeaders, withCredentials, allowedHosts };

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

      // P1：退避仅在有失败（限速）信号时触发，且优先采用服务端 Retry-After 指示的时长；
      // 无信号时退化为固定 RETRY_DELAY。成功批次不再有任何固定等待（见下方循环尾）。
      const backoff = results.reduce((max, r) => {
        const ra = (r as { retryAfterMs?: number }).retryAfterMs;
        return typeof ra === "number" && ra > max ? ra : max;
      }, RETRY_DELAY);

      debugWarn(
        `文件 ${fileId} 下载重试 ${retryAttempts[fileId]}/${MAX_RETRY_ATTEMPTS}（${backoff}ms 后）`
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

      await new Promise((resolve) => setTimeout(resolve, backoff));
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

    // P1：成功批次不再有任何固定等待（此前此处有 isFirstDownload ? 100 : 10 的固定
    // 让出，会随分片数线性拖慢大文件吞吐）。网络/分片 await 本身已让出事件循环；
    // 仅失败批次按上方 backoff 退避。此处仅在"首批"（首次下载单并发预热）做一次
    // 极小让出，避免极端情况下首屏渲染被单文件阻塞。
    if (isFirstDownload) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
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
    const { authHeaders, withCredentials, allowedHosts } =
      downloadAuthSettings[fileId] ?? {};

    // F3：SSRF / token 泄漏防护。仅当分片 URL 的 host 命中白名单时才携带鉴权头；
    // 非白名单目标（如错误/恶意的 baseURL）一律不附加 authHeaders、且不带 Cookie，
    // 避免把 Bearer 令牌发往任意域名。
    const sendAuth = isUrlAllowed(url, allowedHosts ?? []);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        headers: {
          ...(sendAuth ? (authHeaders ?? {}) : {}),
          Range: `bytes=${start}-${end}`,
        },
        credentials:
          sendAuth && withCredentials === true ? "include" : "same-origin",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!activeDownloads[fileId]) {
        return { success: false, chunkIndex, paused: true };
      }

      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("Retry-After")
        );
        const err = new Error(`HTTP error! status: ${response.status}`);
        // 携带重试信号（P1）：429/503 带 Retry-After 时，批次退避时长优先采用之
        if (typeof retryAfterMs === "number") {
          (err as Error & { retryAfterMs?: number }).retryAfterMs =
            retryAfterMs;
        }
        throw err;
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
    const error = err as Error & { retryAfterMs?: number };
    debugError(
      `下载分片 ${chunkIndex} 失败 (尝试 ${chunkRetryAttempts[chunkId]}/${MAX_RETRY_ATTEMPTS}):`,
      error
    );

    return {
      success: false,
      chunkIndex,
      error: error instanceof Error ? error.message : "未知错误",
      ...(typeof error.retryAfterMs === "number"
        ? { retryAfterMs: error.retryAfterMs }
        : {}),
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
