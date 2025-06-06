// 定义Worker上下文类型
const ctx: Worker = self as any;

// 存储活跃的下载任务
const activeDownloads: Record<string, boolean> = {};
// 存储已经处理过的文件ID，用于识别第一次下载的文件
const processedFiles = new Set<string>();
// 存储重试次数
const retryAttempts: Record<string, number> = {};
// 最大重试次数
const MAX_RETRY_ATTEMPTS = 3;
// 重试延迟（毫秒）
const RETRY_DELAY = 1000;

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
    default:
      console.error("未知的Worker消息类型:", type);
  }
});

// 处理下载
async function handleDownload(payload: {
  fileId: string;
  url: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  pendingChunks: number[];
}) {
  const { fileId, url, fileSize, chunkSize, totalChunks, pendingChunks } =
    payload;

  const isFirstDownload = !processedFiles.has(fileId);
  console.log(
    `开始下载文件: ${fileId}, 总分片: ${totalChunks}, 待下载分片: ${pendingChunks.length}, 是否首次下载: ${isFirstDownload}`
  );

  // 标记为活跃下载
  activeDownloads[fileId] = true;
  // 记录此文件已被处理
  processedFiles.add(fileId);
  // 重置重试计数
  retryAttempts[fileId] = 0;

  // 最大并发数 - 对于第一个文件降低并发数以提高稳定性
  const maxConcurrent = isFirstDownload ? 1 : 3;
  let downloadedChunks = totalChunks - pendingChunks.length;
  let remainingChunks = [...pendingChunks];

  // 发送初始进度
  ctx.postMessage({
    type: "PROGRESS",
    payload: {
      fileId,
      progress: Math.round((downloadedChunks / totalChunks) * 100),
      downloadedChunks,
    },
  });

  // 主下载循环
  while (remainingChunks.length > 0) {
    // 每次循环都检查是否已暂停或取消
    if (!activeDownloads[fileId]) {
      console.log(`检测到下载已暂停或取消: ${fileId}`);
      return;
    }

    // 获取当前批次
    const currentBatch = remainingChunks.splice(0, maxConcurrent);
    console.log(`准备下载下一批分片: ${currentBatch.join(", ")}`);

    // 创建下载Promise
    const chunkPromises = currentBatch.map((chunkIndex) =>
      downloadChunk(fileId, url, chunkIndex, fileSize, chunkSize)
    );

    // 等待所有分片下载完成
    const results = await Promise.all(chunkPromises);

    // 再次检查是否已暂停或取消
    if (!activeDownloads[fileId]) {
      console.log(`分片下载完成后检测到下载已暂停或取消: ${fileId}`);
      return;
    }

    // 更新进度
    const successfulDownloads = results.filter((r) => r.success).length;
    downloadedChunks += successfulDownloads;
    const progress = Math.round((downloadedChunks / totalChunks) * 100);

    console.log(
      `更新下载进度: ${fileId}, 完成: ${downloadedChunks}/${totalChunks}, 进度: ${progress}%`
    );

    // 发送进度更新
    ctx.postMessage({
      type: "PROGRESS",
      payload: {
        fileId,
        progress,
        downloadedChunks,
      },
    });

    // 检查失败的分片
    const failedChunks = results
      .filter((r) => !r.success && !r.paused)
      .map((r) => r.chunkIndex);

    if (failedChunks.length > 0) {
      console.log(`有分片下载失败: ${failedChunks.join(", ")}`);

      // 增加重试计数
      retryAttempts[fileId] = (retryAttempts[fileId] || 0) + 1;

      // 如果超过最大重试次数，暂停下载
      if (retryAttempts[fileId] > MAX_RETRY_ATTEMPTS) {
        console.warn(`文件 ${fileId} 下载失败次数过多，暂停下载`);
        activeDownloads[fileId] = false;

        ctx.postMessage({
          type: "ERROR",
          payload: {
            fileId,
            chunkIndex: failedChunks[0],
            error: `下载失败次数过多，请检查网络连接后重试`,
          },
        });

        return;
      }

      // 添加延迟，避免立即重试
      console.log(`等待 ${RETRY_DELAY}ms 后重试下载失败的分片`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    } else {
      // 重置重试计数，因为这一批次成功了
      retryAttempts[fileId] = 0;
    }

    // 将失败的分片添加回队列
    remainingChunks = [...remainingChunks, ...failedChunks];

    // 如果没有更多分片，完成下载
    if (remainingChunks.length === 0) {
      console.log(`所有分片下载完成: ${fileId}`);

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

// 下载单个分片
async function downloadChunk(
  fileId: string,
  url: string,
  chunkIndex: number,
  fileSize: number,
  chunkSize: number
) {
  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize - 1, fileSize - 1);
  const maxRetries = 3; // 单个分片的最大重试次数
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      // 开始前检查是否已暂停
      if (!activeDownloads[fileId]) {
        console.log(`分片${chunkIndex}下载前检测到暂停状态`);
        return { success: false, chunkIndex, paused: true };
      }

      console.log(
        `开始下载分片 ${chunkIndex}: 字节范围 ${start}-${end}, 尝试 ${
          retryCount + 1
        }/${maxRetries + 1}`
      );

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
          console.log(`分片${chunkIndex}下载后检测到暂停状态`);
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

        console.log(`分片 ${chunkIndex} 下载完成，大小: ${blob.size} 字节`);

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
        `下载分片 ${chunkIndex} 失败 (尝试 ${retryCount + 1}/${
          maxRetries + 1
        }):`,
        error
      );

      // 如果已经达到最大重试次数，报告错误
      if (retryCount >= maxRetries) {
        ctx.postMessage({
          type: "ERROR",
          payload: {
            fileId,
            chunkIndex,
            error: error instanceof Error ? error.message : "未知错误",
          },
        });

        return {
          success: false,
          chunkIndex,
          error: error instanceof Error ? error.message : "未知错误",
        };
      }

      // 否则增加重试计数并继续
      retryCount++;

      // 等待一段时间再重试，时间随重试次数增加
      const delay = 1000 * Math.pow(2, retryCount - 1); // 指数退避: 1s, 2s, 4s...
      console.log(`等待 ${delay}ms 后重试下载分片 ${chunkIndex}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // 如果所有重试都失败
  return {
    success: false,
    chunkIndex,
    error: "达到最大重试次数",
  };
}

// 处理暂停
function handlePause(payload: { fileId: string }) {
  const { fileId } = payload;
  console.log(`Worker收到暂停命令: ${fileId}`);

  // 立即设置为非活跃状态，阻止后续下载
  activeDownloads[fileId] = false;

  // 等待一小段时间，确保当前正在进行的下载操作能够完成
  setTimeout(() => {
    // 发送确认消息回主线程
    ctx.postMessage({
      type: "PAUSED",
      payload: { fileId },
    });

    console.log(`Worker已暂停下载: ${fileId}`);
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
