// 定义Worker上下文类型
const ctx: Worker = self as any;

// 存储活跃的下载任务
const activeDownloads: Record<string, boolean> = {};
// 存储已经处理过的文件ID，用于识别第一次下载的文件
const processedFiles = new Set<string>();
// 存储重试次数 - 每个文件的总重试次数
const retryAttempts: Record<string, number> = {};
// 每个分片的重试次数
const chunkRetryAttempts: Record<string, number> = {};
// 最大重试次数
const MAX_RETRY_ATTEMPTS = 3;
// 重试延迟（毫秒）
const RETRY_DELAY = 1000;
// 进度更新的最小间隔（毫秒）
const PROGRESS_UPDATE_INTERVAL = 500;
// 记录上次进度更新的时间
const lastProgressUpdate: Record<string, number> = {};
// 记录上次发送的进度值
const lastProgressValue: Record<string, number> = {};
// 进度变化阈值，超过此值才会触发更新
const PROGRESS_CHANGE_THRESHOLD = 3; // 百分比

// 默认并发设置
const DEFAULT_FILE_CONCURRENCY = 3;
const DEFAULT_CHUNK_CONCURRENCY = 3;

// 存储每个文件的并发设置
const fileConcurrencySettings: Record<string, number> = {};
const chunkConcurrencySettings: Record<string, number> = {};

// 接收消息
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

// 处理更新并发设置
function handleUpdateConcurrency(payload: {
  fileId?: string;
  fileConcurrency?: number;
  chunkConcurrency?: number;
}) {
  const { fileId, fileConcurrency, chunkConcurrency } = payload;

  // 如果提供了fileId，更新特定文件的设置
  if (fileId) {
    if (fileConcurrency !== undefined) {
      fileConcurrencySettings[fileId] = fileConcurrency;
    }
    if (chunkConcurrency !== undefined) {
      chunkConcurrencySettings[fileId] = chunkConcurrency;
    }
  }

  // 如果没有提供fileId，更新全局默认设置
  if (!fileId) {
    console.log("更新全局并发设置", { fileConcurrency, chunkConcurrency });
  } else {
    console.log(`更新文件 ${fileId} 的并发设置`, {
      fileConcurrency,
      chunkConcurrency,
    });
  }
}

// 获取文件的并发设置
function getFileConcurrency(fileId: string): number {
  return fileConcurrencySettings[fileId] || DEFAULT_FILE_CONCURRENCY;
}

// 获取分片的并发设置
function getChunkConcurrency(fileId: string): number {
  return chunkConcurrencySettings[fileId] || DEFAULT_CHUNK_CONCURRENCY;
}

// 处理下载
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

  // 更新并发设置（如果提供）
  if (fileConcurrency !== undefined) {
    fileConcurrencySettings[fileId] = fileConcurrency;
  }
  if (chunkConcurrency !== undefined) {
    chunkConcurrencySettings[fileId] = chunkConcurrency;
  }

  const isFirstDownload = !processedFiles.has(fileId);

  // 标记为活跃下载
  activeDownloads[fileId] = true;
  // 记录此文件已被处理
  processedFiles.add(fileId);
  // 重置重试计数
  retryAttempts[fileId] = 0;
  // 初始化进度更新时间
  lastProgressUpdate[fileId] = 0;

  // 初始化分片重试计数
  pendingChunks.forEach((chunkIndex) => {
    const chunkId = `${fileId}_${chunkIndex}`;
    chunkRetryAttempts[chunkId] = 0;
  });

  // 获取分片并发数 - 对于第一个文件降低并发数以提高稳定性
  const maxConcurrent = isFirstDownload ? 1 : getChunkConcurrency(fileId);

  let downloadedChunks = totalChunks - pendingChunks.length;
  let remainingChunks = [...pendingChunks];

  // 发送初始进度
  sendProgressUpdate(fileId, downloadedChunks, totalChunks);

  // 主下载循环
  while (remainingChunks.length > 0 && activeDownloads[fileId]) {
    // 每次循环都检查是否已暂停或取消
    if (!activeDownloads[fileId]) {
      return;
    }

    // 获取当前批次，使用设置的并发数
    const currentBatch = remainingChunks.splice(0, maxConcurrent);

    // 创建下载Promise
    const chunkPromises = currentBatch.map((chunkIndex) =>
      downloadChunk(fileId, url, chunkIndex, fileSize, chunkSize)
    );

    // 等待所有分片下载完成
    const results = await Promise.all(chunkPromises);

    // 再次检查是否已暂停或取消
    if (!activeDownloads[fileId]) {
      return;
    }

    // 更新进度
    const successfulDownloads = results.filter((r) => r.success).length;
    downloadedChunks += successfulDownloads;

    // 发送进度更新（使用限流函数）
    sendProgressUpdate(fileId, downloadedChunks, totalChunks);

    // 检查失败的分片
    const failedChunks = results
      .filter((r) => !r.success && !r.paused)
      .map((r) => r.chunkIndex);

    if (failedChunks.length > 0) {
      // 增加文件级重试计数
      retryAttempts[fileId] = (retryAttempts[fileId] || 0) + 1;

      console.warn(
        `文件 ${fileId} 下载重试 ${retryAttempts[fileId]}/${MAX_RETRY_ATTEMPTS}`
      );

      // 如果超过最大重试次数，暂停下载
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

      // 检查是否所有失败的分片都已经超过最大重试次数
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

    // 将未达到最大重试次数的失败分片添加回队列
    const retriableChunks = failedChunks.filter((chunkIndex) => {
      const chunkId = `${fileId}_${chunkIndex}`;
      return chunkRetryAttempts[chunkId] < MAX_RETRY_ATTEMPTS;
    });

    remainingChunks = [...remainingChunks, ...retriableChunks];

    // 如果没有更多分片，完成下载
    if (remainingChunks.length === 0) {
      // 发送最终进度（确保100%）
      sendProgressUpdate(fileId, totalChunks, totalChunks, true);

      // 确保所有分片都已成功保存
      ctx.postMessage({
        type: "COMPLETE",
        payload: {
          fileId,
          downloadedChunks,
        },
      });
    }

    // 添加小延迟，便于检测暂停状态
    await new Promise((resolve) =>
      setTimeout(resolve, isFirstDownload ? 100 : 10)
    );
  }
}

// 发送进度更新（带限流）
function sendProgressUpdate(
  fileId: string,
  downloadedChunks: number,
  totalChunks: number,
  forceUpdate = false
) {
  const now = Date.now();
  const progress = Math.round((downloadedChunks / totalChunks) * 100);

  // 获取上次进度值，如果没有则默认为-1
  const lastProgress = lastProgressValue[fileId] ?? -1;

  // 进度变化大小
  const progressChange = Math.abs(progress - lastProgress);

  // 条件判断：
  // 1. 强制更新
  // 2. 进度为0%（刚开始）或100%（结束）
  // 3. 进度变化超过阈值
  // 4. 距离上次更新时间超过了间隔
  if (
    forceUpdate ||
    progress === 0 ||
    progress === 100 ||
    progressChange >= PROGRESS_CHANGE_THRESHOLD ||
    now - (lastProgressUpdate[fileId] || 0) >= PROGRESS_UPDATE_INTERVAL
  ) {
    // 发送进度更新
    ctx.postMessage({
      type: "PROGRESS",
      payload: {
        fileId,
        progress,
        downloadedChunks,
      },
    });

    // 更新最后一次进度更新时间和值
    lastProgressUpdate[fileId] = now;
    lastProgressValue[fileId] = progress;
  }
}

// 下载单个分片
async function downloadChunk(
  fileId: string,
  url: string,
  chunkIndex: number,
  fileSize: number,
  chunkSize: number
) {
  const start = chunkIndex * chunkSize;
  // 确保最后一个分片不超出文件大小
  const end = Math.min(start + chunkSize - 1, fileSize - 1);
  const chunkId = `${fileId}_${chunkIndex}`;

  // 记录实际分片大小，用于调试
  const actualChunkSize = end - start + 1;
  console.debug(
    `下载分片 ${chunkIndex}: 范围 ${start}-${end}, 大小: ${actualChunkSize}字节`
  );

  // 增加分片重试计数
  chunkRetryAttempts[chunkId] = (chunkRetryAttempts[chunkId] || 0) + 1;

  // 如果已达到最大重试次数，直接返回失败
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
    // 开始前检查是否已暂停
    if (!activeDownloads[fileId]) {
      return { success: false, chunkIndex, paused: true };
    }

    // 添加超时处理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch(url, {
        headers: {
          Range: `bytes=${start}-${end}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId); // 清除超时

      // 下载后再次检查是否已暂停
      if (!activeDownloads[fileId]) {
        return { success: false, chunkIndex, paused: true };
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();

      // 验证blob大小
      if (blob.size === 0) {
        throw new Error(`分片 ${chunkIndex} 下载完成，但大小为0字节`);
      }

      // 发送分片数据到主线程
      ctx.postMessage({
        type: "CHUNK_DOWNLOADED",
        payload: {
          fileId,
          chunkIndex,
          blob,
          size: blob.size,
        },
      });

      // 重置该分片的重试计数，因为成功了
      chunkRetryAttempts[chunkId] = 0;

      return {
        success: true,
        chunkIndex,
        size: blob.size,
      };
    } catch (error) {
      // 清除可能存在的超时
      clearTimeout(timeoutId);

      // 如果是超时错误，特殊处理
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        console.error(`下载分片 ${chunkIndex} 超时`);
        throw new Error(`下载超时`);
      }

      throw error; // 抛出其他错误，进入外层catch处理
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

// 处理暂停
function handlePause(payload: { fileId: string }) {
  const { fileId } = payload;

  // 立即设置为非活跃状态，阻止后续下载
  activeDownloads[fileId] = false;

  // 等待一小段时间，确保当前正在进行的下载操作能够完成
  setTimeout(() => {
    // 发送确认消息回主线程
    ctx.postMessage({
      type: "PAUSED",
      payload: { fileId },
    });
  }, 100);
}

// 处理恢复
function handleResume(payload: { fileId: string }) {
  const { fileId } = payload;
  activeDownloads[fileId] = true;

  ctx.postMessage({
    type: "RESUMED",
    payload: { fileId },
  });
}

// 处理取消
function handleCancel(payload: { fileId: string }) {
  const { fileId } = payload;
  activeDownloads[fileId] = false;

  ctx.postMessage({
    type: "CANCELLED",
    payload: { fileId },
  });
}

// 导出空对象，使TypeScript将此文件视为模块
export {};
