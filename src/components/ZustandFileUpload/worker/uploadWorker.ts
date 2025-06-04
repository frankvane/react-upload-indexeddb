// 实现一个简单的 MD5 哈希函数
function calculateMD5(buffer: ArrayBuffer): string {
  // 这里简化实现，实际项目中应该使用完整的 MD5 算法
  // 或者考虑使用 Web Crypto API
  const array = new Uint8Array(buffer);
  let hash = 0;
  for (let i = 0; i < array.length; i++) {
    hash = (hash << 5) - hash + array[i];
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

// 简单的重试函数
async function retry<T>(
  fn: () => Promise<T>,
  options: {
    times: number;
    interval: number | ((retryCount: number) => number);
    errorFilter?: (err: Error) => boolean;
  }
): Promise<T> {
  let lastError: Error;
  let retryCount = 0;

  while (retryCount < options.times) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 检查是否应该重试这个错误
      if (options.errorFilter && !options.errorFilter(lastError)) {
        throw lastError;
      }

      // 发送重试消息到主线程
      self.postMessage({
        type: "retry",
        error: lastError.message,
        attemptNumber: retryCount,
        retriesLeft: options.times - retryCount - 1,
      });

      // 等待重试间隔
      const interval =
        typeof options.interval === "function"
          ? options.interval(retryCount)
          : options.interval;

      await new Promise((resolve) => setTimeout(resolve, interval));
      retryCount++;
    }
  }

  throw lastError!;
}

// 使用重试函数进行带重试的请求
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  {
    maxRetries = 3,
    timeout = 30000,
    retryInterval = 1000,
  }: {
    maxRetries?: number;
    timeout?: number;
    retryInterval?: number;
  } = {}
): Promise<Response> {
  return retry(
    async () => {
      // 创建 AbortController 用于超时控制
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(
            `HTTP 错误 ${response.status}: ${response.statusText}`
          );
        }

        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    },
    {
      times: maxRetries,
      interval: (retryCount) => retryInterval * (retryCount + 1),
      errorFilter: (err) => {
        // 只有网络错误、超时和5xx服务器错误才会重试
        const isNetworkError =
          err.name === "TypeError" || err.message.includes("network");
        const isTimeoutError =
          err.name === "AbortError" || err.message.includes("timeout");
        const isServerError =
          err.message.includes("500") || err.message.includes("server");
        return isNetworkError || isTimeoutError || isServerError;
      },
    }
  );
}

self.onmessage = async (e: MessageEvent) => {
  const { fileInfo, fileBuffer, networkParams } = e.data;
  const chunkSize = fileInfo.chunkSize || 1024 * 1024;
  const chunkCount = Math.ceil(fileBuffer.byteLength / chunkSize);

  // 使用网络参数中的分片并发数和重试参数
  const chunkConcurrency = networkParams?.chunkConcurrency || 2;
  const retryOptions = {
    maxRetries: networkParams?.maxRetries || 3,
    timeout: networkParams?.timeout || 30000,
    retryInterval: networkParams?.retryInterval || 1000,
  };

  const chunk_md5s: string[] = [];
  // 1. 计算所有分片的md5
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(fileBuffer.byteLength, start + chunkSize);
    const chunk = fileBuffer.slice(start, end);
    const chunkMd5 = calculateMD5(chunk);
    chunk_md5s.push(chunkMd5);
  }

  // 2. 秒传确认
  try {
    const instantRes = await fetchWithRetry(
      "http://localhost:3000/api/file/instant",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: fileInfo.hash,
          md5: fileInfo.hash,
          name: fileInfo.fileName,
          size: fileInfo.fileSize,
          total: chunkCount,
          chunk_md5s,
        }),
      },
      retryOptions
    );

    const instantData = await instantRes.json();
    if (instantData.data?.uploaded) {
      self.postMessage({ type: "done", skipped: true });
      return;
    }

    const needUploadChunks: number[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const exist = instantData.data?.chunkCheckResult?.find(
        (c: { index: number; exist: boolean }) => c.index === i
      )?.exist;
      if (!exist) needUploadChunks.push(i);
    }

    // 记录已完成的分片数量，用于计算进度
    const completedChunks = chunkCount - needUploadChunks.length;
    let totalUploadedChunks = completedChunks;
    const failedChunks: number[] = [];

    // 3. 分片上传 - 使用并发控制
    const uploadTasks = needUploadChunks.map((i) => {
      return async () => {
        const start = i * chunkSize;
        const end = Math.min(fileBuffer.byteLength, start + chunkSize);
        const chunk = fileBuffer.slice(start, end);
        const chunkMd5 = chunk_md5s[i];

        const formData = new FormData();
        formData.append("file_id", fileInfo.hash);
        formData.append("index", i.toString());
        formData.append("chunk", new Blob([chunk]));
        formData.append("total", chunkCount.toString());
        formData.append("chunk_md5", chunkMd5);

        try {
          await fetchWithRetry(
            "http://localhost:3000/api/file/upload",
            {
              method: "POST",
              body: formData,
            },
            retryOptions
          );

          // 更新进度
          totalUploadedChunks++;
          const progress = Math.round((totalUploadedChunks / chunkCount) * 100);

          self.postMessage({
            type: "progress",
            progress: progress,
            chunkIndex: i,
          });
        } catch (error) {
          // 记录失败的分片
          failedChunks.push(i);
          console.error(`分片 ${i} 上传失败:`, error);
          throw error;
        }
      };
    });

    // 使用并发控制函数执行上传任务
    await runWithConcurrency(uploadTasks, chunkConcurrency);

    // 如果有失败的分片，报告错误
    if (failedChunks.length > 0) {
      self.postMessage({
        type: "error",
        message: `有 ${failedChunks.length} 个分片上传失败，请重试上传`,
        failedChunks: failedChunks,
      });
      return;
    }

    // 4. 合并
    await fetchWithRetry(
      "http://localhost:3000/api/file/merge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: fileInfo.hash,
          md5: fileInfo.hash,
          name: fileInfo.fileName,
          size: fileInfo.fileSize,
          total: chunkCount,
        }),
      },
      retryOptions
    );

    self.postMessage({ type: "done", skipped: false });
  } catch (error) {
    // 上传过程中出现致命错误
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

// 简单的并发控制函数
async function runWithConcurrency(
  tasks: (() => Promise<void>)[],
  concurrency: number
): Promise<{ completed: number; failed: number; failedIndices: number[] }> {
  // 当前运行的任务数
  let running = 0;
  // 下一个要执行的任务索引
  let taskIndex = 0;
  // 成功和失败的任务计数
  let completed = 0;
  let failed = 0;
  // 失败的任务索引
  const failedIndices: number[] = [];

  return new Promise((resolve) => {
    // 启动初始任务
    const startNext = () => {
      // 如果所有任务都完成了，解析 Promise
      if (taskIndex >= tasks.length && running === 0) {
        resolve({ completed, failed, failedIndices });
        return;
      }

      // 当有空闲并且还有任务时，启动新任务
      while (running < concurrency && taskIndex < tasks.length) {
        const currentIndex = taskIndex;
        const currentTask = tasks[taskIndex++];
        running++;

        currentTask()
          .then(() => {
            completed++;
            running--;
            startNext(); // 任务完成后，尝试启动下一个任务
          })
          .catch(() => {
            failed++;
            failedIndices.push(currentIndex);
            running--;
            startNext(); // 即使失败也尝试启动下一个任务
          });
      }
    };

    startNext();
  });
}
