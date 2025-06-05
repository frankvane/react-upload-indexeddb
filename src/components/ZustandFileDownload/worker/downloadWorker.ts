/**
 * ZustandFileDownload 下载 Worker
 *
 * 负责处理文件分片下载、断点续传和进度报告
 */

import {
  DownloadChunk,
  DownloadStatus,
  DownloadTask,
  WorkerMessage,
  WorkerMessageType,
} from "../types/download";

// Worker上下文
const ctx: Worker = self as unknown as Worker;

// 存储当前下载任务
let currentTask: DownloadTask | null = null;
// 存储活跃的下载请求
const activeRequests: Map<number, AbortController> = new Map();
// 存储下载速度计算数据
let speedCalcData = {
  lastTime: 0,
  lastLoaded: 0,
  speed: 0,
  samples: [] as number[],
};

/**
 * 初始化Worker
 */
function init() {
  ctx.addEventListener("message", handleMessage);
  postMessage({ type: "debug", message: "Download worker initialized" });
}

/**
 * 处理主线程消息
 */
function handleMessage(event: MessageEvent) {
  const message: WorkerMessage = event.data;

  switch (message.type) {
    case "download":
      if (message.data) {
        startDownload(message.data);
      }
      break;
    case "pause":
      pauseDownload();
      break;
    case "resume":
      if (currentTask) {
        resumeDownload();
      }
      break;
    case "cancel":
      cancelDownload();
      break;
    default:
      postMessage({
        type: "error",
        message: `Unknown message type: ${message.type}`,
      });
  }
}

/**
 * 开始下载任务
 */
async function startDownload(task: DownloadTask) {
  try {
    // 如果有正在进行的任务，先取消
    if (currentTask) {
      cancelDownload();
    }

    currentTask = task;
    postMessage({
      type: "debug",
      message: `Starting download for ${task.fileName}`,
      taskId: task.id,
    });

    // 检查是否支持断点续传
    const supportsResume = await checkResumeSupport(task.url);

    if (!supportsResume) {
      postMessage({
        type: "debug",
        message: "Server does not support resume",
        taskId: task.id,
      });

      // 更新任务状态
      currentTask.resumeSupported = false;
    }

    // 准备分片
    const chunks = prepareChunks(task);

    // 开始下载分片
    await downloadChunks(chunks);
  } catch (error) {
    handleError(error);
  }
}

/**
 * 检查服务器是否支持断点续传
 */
async function checkResumeSupport(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });

    // 检查Accept-Ranges头
    const acceptRanges = response.headers.get("accept-ranges");
    if (acceptRanges && acceptRanges !== "none") {
      return true;
    }

    // 有些服务器不返回Accept-Ranges但支持Range
    const contentLength = response.headers.get("content-length");
    if (!contentLength) {
      return false;
    }

    // 尝试请求一个字节范围
    const rangeResponse = await fetch(url, {
      headers: { Range: "bytes=0-0" },
    });

    // 如果返回206 Partial Content，说明支持断点续传
    return rangeResponse.status === 206;
  } catch (error) {
    console.error("Error checking resume support:", error);
    return false;
  }
}

/**
 * 准备下载分片
 */
function prepareChunks(task: DownloadTask): DownloadChunk[] {
  const { fileSize, id: taskId, chunks } = task;

  // 如果已有分片信息，使用现有的
  if (chunks && chunks.length > 0) {
    return chunks;
  }

  // 根据文件大小确定分片大小
  let chunkSize = 5 * 1024 * 1024; // 默认5MB

  if (fileSize > 1024 * 1024 * 1024) {
    // 大于1GB的文件，使用20MB分片
    chunkSize = 20 * 1024 * 1024;
  } else if (fileSize > 100 * 1024 * 1024) {
    // 大于100MB的文件，使用10MB分片
    chunkSize = 10 * 1024 * 1024;
  }

  // 计算分片数量
  const chunkCount = Math.ceil(fileSize / chunkSize);

  // 创建分片
  const newChunks: DownloadChunk[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize - 1, fileSize - 1);
    const size = end - start + 1;

    newChunks.push({
      id: `${taskId}_chunk_${i}`,
      taskId,
      index: i,
      start,
      end,
      size,
      downloaded: 0,
      status: DownloadStatus.QUEUED,
      storageType: size > 5 * 1024 * 1024 ? "filesystem" : "indexeddb",
      retryCount: 0,
    });
  }

  return newChunks;
}

/**
 * 下载所有分片
 */
async function downloadChunks(chunks: DownloadChunk[]) {
  if (!currentTask) {
    return;
  }

  // 获取未完成的分片
  const pendingChunks = chunks.filter(
    (chunk) => chunk.status !== DownloadStatus.COMPLETED
  );

  if (pendingChunks.length === 0) {
    // 所有分片已下载完成
    completeDownload();
    return;
  }

  // 更新任务状态
  currentTask.status = DownloadStatus.DOWNLOADING;
  currentTask.chunks = chunks;

  // 初始化速度计算
  resetSpeedCalculation();

  // 并发下载分片，最多5个并发
  const maxConcurrent = 5;
  let activeTasks = 0;
  let nextChunkIndex = 0;

  return new Promise<void>((resolve, reject) => {
    // 开始下载函数
    const startNextChunk = async () => {
      if (nextChunkIndex >= pendingChunks.length) {
        // 没有更多分片需要下载
        if (activeTasks === 0) {
          resolve();
        }
        return;
      }

      const chunk = pendingChunks[nextChunkIndex++];
      activeTasks++;

      try {
        await downloadChunk(chunk);
        activeTasks--;

        // 检查是否所有分片都已完成
        const allCompleted = chunks.every(
          (c) => c.status === DownloadStatus.COMPLETED
        );

        if (allCompleted) {
          resolve();
        } else {
          // 继续下载下一个分片
          startNextChunk();
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          // 下载被中止，不视为错误
          activeTasks--;
          if (activeTasks === 0 && nextChunkIndex >= pendingChunks.length) {
            resolve();
          }
        } else {
          // 真正的错误
          reject(error);
        }
      }
    };

    // 启动初始的并发下载
    for (let i = 0; i < Math.min(maxConcurrent, pendingChunks.length); i++) {
      startNextChunk();
    }
  });
}

/**
 * 下载单个分片
 */
async function downloadChunk(chunk: DownloadChunk): Promise<void> {
  if (!currentTask) {
    throw new Error("No active download task");
  }

  // 更新分片状态
  chunk.status = DownloadStatus.DOWNLOADING;

  // 创建中止控制器
  const controller = new AbortController();
  activeRequests.set(chunk.index, controller);

  try {
    // 准备请求头
    const headers = new Headers();
    if (chunk.downloaded > 0) {
      // 断点续传
      headers.append(
        "Range",
        `bytes=${chunk.start + chunk.downloaded}-${chunk.end}`
      );
    } else {
      // 从头开始下载
      headers.append("Range", `bytes=${chunk.start}-${chunk.end}`);
    }

    // 发送请求
    const response = await fetch(currentTask.url, {
      headers,
      signal: controller.signal,
    });

    // 检查响应状态
    if (!response.ok && response.status !== 206) {
      throw new Error(
        `Failed to download chunk: ${response.status} ${response.statusText}`
      );
    }

    // 获取响应数据
    const reader = response.body!.getReader();

    let receivedLength = chunk.downloaded;
    const chunks: Uint8Array[] = [];

    // 读取数据流
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
      receivedLength += value.length;

      // 更新下载进度
      chunk.downloaded = receivedLength;
      updateProgress();
    }

    // 合并所有数据块
    const chunksAll = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      chunksAll.set(chunk, position);
      position += chunk.length;
    }

    // 存储分片数据
    await storeChunkData(chunk, chunksAll);

    // 更新分片状态
    chunk.status = DownloadStatus.COMPLETED;

    // 清理请求
    activeRequests.delete(chunk.index);

    // 更新进度
    updateProgress();
  } catch (error: unknown) {
    // 清理请求
    activeRequests.delete(chunk.index);

    // 如果是中止错误，不视为失败
    if (error instanceof Error && error.name === "AbortError") {
      chunk.status = DownloadStatus.PAUSED;
      throw error;
    }

    // 更新分片状态
    chunk.status = DownloadStatus.FAILED;
    chunk.error = error instanceof Error ? error.message : String(error);

    // 如果重试次数未达到上限，重试下载
    if (chunk.retryCount < 3) {
      chunk.retryCount++;
      return downloadChunk(chunk);
    }

    throw error;
  }
}

/**
 * 存储分片数据
 */
async function storeChunkData(
  chunk: DownloadChunk,
  data: Uint8Array
): Promise<void> {
  if (!currentTask) {
    return;
  }

  try {
    if (chunk.storageType === "indexeddb") {
      // 存储到IndexedDB
      await storeInIndexedDB(chunk, data);
    } else {
      // 存储到FileSystem API
      await storeInFileSystem(chunk, data);
    }
  } catch (error) {
    console.error("Failed to store chunk data:", error);
    throw error;
  }
}

/**
 * 存储数据到IndexedDB
 */
async function storeInIndexedDB(
  chunk: DownloadChunk,
  data: Uint8Array
): Promise<void> {
  if (!currentTask) {
    return;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open("zustand-file-download", 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("chunks")) {
        db.createObjectStore("chunks", { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(["chunks"], "readwrite");
      const store = transaction.objectStore("chunks");

      const storeRequest = store.put({
        id: chunk.id,
        taskId: chunk.taskId,
        data: data,
        timestamp: Date.now(),
      });

      storeRequest.onsuccess = () => {
        resolve();
      };

      storeRequest.onerror = () => {
        reject(new Error("Failed to store chunk in IndexedDB"));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    };

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"));
    };
  });
}

/**
 * 存储数据到FileSystem API
 */
async function storeInFileSystem(
  chunk: DownloadChunk,
  data: Uint8Array
): Promise<void> {
  if (!currentTask) {
    return;
  }

  // 检查是否支持FileSystem API
  if (!("showSaveFilePicker" in window)) {
    // 降级到IndexedDB
    chunk.storageType = "indexeddb";
    return storeInIndexedDB(chunk, data);
  }

  try {
    // 使用文件系统访问API
    // 注意：这需要用户交互才能使用，可能需要降级方案
    // 这里使用的是较新的File System Access API

    // 由于Worker中无法直接使用File System Access API
    // 我们需要将数据发送到主线程处理
    const msg: WorkerMessage = {
      type: "store-chunk",
      taskId: currentTask.id,
      chunkIndex: chunk.index,
      data: data.buffer,
    };

    postMessage(msg, [data.buffer]);

    // 设置存储路径
    chunk.storagePath = `${currentTask.id}/${chunk.index}`;

    return Promise.resolve();
  } catch (error) {
    console.error("Failed to store in FileSystem API:", error);

    // 降级到IndexedDB
    chunk.storageType = "indexeddb";
    return storeInIndexedDB(chunk, data);
  }
}

/**
 * 更新下载进度
 */
function updateProgress() {
  if (!currentTask) {
    return;
  }

  const { chunks } = currentTask;
  if (!chunks || chunks.length === 0) {
    return;
  }

  // 计算总下载大小和已下载大小
  let totalSize = 0;
  let downloadedSize = 0;

  for (const chunk of chunks) {
    totalSize += chunk.size;
    downloadedSize += chunk.downloaded;
  }

  // 计算进度百分比
  const progress = Math.floor((downloadedSize / totalSize) * 100);

  // 计算下载速度
  const now = Date.now();
  const timeDiff = now - speedCalcData.lastTime;

  if (timeDiff > 1000) {
    // 每秒更新一次速度
    const loadDiff = downloadedSize - speedCalcData.lastLoaded;
    const speed = loadDiff / (timeDiff / 1000); // bytes/s

    // 添加到样本中
    speedCalcData.samples.push(speed);

    // 保留最近5个样本
    if (speedCalcData.samples.length > 5) {
      speedCalcData.samples.shift();
    }

    // 计算平均速度
    const avgSpeed =
      speedCalcData.samples.reduce((sum, s) => sum + s, 0) /
      speedCalcData.samples.length;

    speedCalcData.speed = avgSpeed;
    speedCalcData.lastTime = now;
    speedCalcData.lastLoaded = downloadedSize;

    // 计算剩余时间
    const remainingBytes = totalSize - downloadedSize;
    const timeRemaining =
      avgSpeed > 0 ? Math.ceil(remainingBytes / avgSpeed) * 1000 : 0;

    // 更新任务进度
    currentTask.progress = progress;
    currentTask.speed = avgSpeed;
    currentTask.timeRemaining = timeRemaining;

    // 发送进度更新
    postMessage({
      type: "progress",
      taskId: currentTask.id,
      progress,
      data: {
        loaded: downloadedSize,
        total: totalSize,
        speed: avgSpeed,
        timeRemaining,
      },
    });
  }
}

/**
 * 重置速度计算数据
 */
function resetSpeedCalculation() {
  speedCalcData = {
    lastTime: Date.now(),
    lastLoaded: 0,
    speed: 0,
    samples: [],
  };
}

/**
 * 完成下载
 */
function completeDownload() {
  if (!currentTask) {
    return;
  }

  // 更新任务状态
  currentTask.status = DownloadStatus.COMPLETED_CHUNKS;
  currentTask.progress = 100;

  // 发送完成消息
  postMessage({
    type: "done",
    taskId: currentTask.id,
    data: {
      status: DownloadStatus.COMPLETED_CHUNKS,
      chunks: currentTask.chunks,
    },
  });

  // 清理当前任务
  currentTask = null;
  activeRequests.clear();
}

/**
 * 暂停下载
 */
function pauseDownload() {
  if (!currentTask) {
    return;
  }

  // 中止所有活跃的请求
  for (const controller of activeRequests.values()) {
    controller.abort();
  }

  // 清理请求映射
  activeRequests.clear();

  // 更新任务状态
  currentTask.status = DownloadStatus.PAUSED;

  // 发送暂停消息
  postMessage({
    type: "debug",
    message: "Download paused",
    taskId: currentTask.id,
  });
}

/**
 * 恢复下载
 */
function resumeDownload() {
  if (!currentTask) {
    return;
  }

  // 更新任务状态
  currentTask.status = DownloadStatus.DOWNLOADING;

  // 发送恢复消息
  postMessage({
    type: "debug",
    message: "Resuming download",
    taskId: currentTask.id,
  });

  // 重新开始下载
  downloadChunks(currentTask.chunks);
}

/**
 * 取消下载
 */
function cancelDownload() {
  if (!currentTask) {
    return;
  }

  // 中止所有活跃的请求
  for (const controller of activeRequests.values()) {
    controller.abort();
  }

  // 清理请求映射
  activeRequests.clear();

  // 更新任务状态
  currentTask.status = DownloadStatus.CANCELED;

  // 发送取消消息
  postMessage({
    type: "debug",
    message: "Download canceled",
    taskId: currentTask.id,
  });

  // 清理当前任务
  currentTask = null;
}

/**
 * 处理错误
 */
function handleError(error: unknown) {
  const errorMessage = error instanceof Error ? error.message : String(error);

  postMessage({
    type: "error",
    message: errorMessage,
    taskId: currentTask?.id,
  });

  if (currentTask) {
    // 更新任务状态
    currentTask.status = DownloadStatus.FAILED;
    currentTask.error = errorMessage;

    // 清理当前任务
    currentTask = null;
    activeRequests.clear();
  }
}

/**
 * 发送消息到主线程
 */
function postMessage(message: WorkerMessage, transfer?: Transferable[]) {
  ctx.postMessage(message, transfer || []);
}

// 初始化Worker
init();
