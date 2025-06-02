// @ts-expect-error: self 类型
importScripts("https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js");

declare const SparkMD5: {
  ArrayBuffer: { hash(buf: ArrayBuffer): string };
};

// 带重试功能的请求
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  timeout: number = 30000
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 创建 AbortController 用于超时控制
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const fetchOptions = {
        ...options,
        signal: controller.signal,
      };

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP 错误 ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (err) {
      const error = err as Error;
      lastError = error;

      // 记录重试信息
      console.warn(`请求失败 (${attempt + 1}/${maxRetries})`, url, error);

      // 如果是超时或网络错误，等待后重试
      if (error.name === "AbortError" || error.name === "TypeError") {
        // 指数退避策略：等待时间随着重试次数增加
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        // 对于其他类型的错误，直接抛出不重试
        throw error;
      }
    }
  }

  // 如果所有重试都失败，抛出最后一个错误
  throw lastError || new Error("所有重试都失败");
}

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

self.onmessage = async (e) => {
  const { fileInfo, fileBuffer, networkParams } = e.data;
  const chunkSize = fileInfo.chunkSize || 1024 * 1024;
  const chunkCount = Math.ceil(fileBuffer.byteLength / chunkSize);

  // 使用网络参数中的分片并发数，如果没有则默认为2
  const chunkConcurrency = networkParams?.chunkConcurrency || 2;

  // 最大重试次数和超时时间
  const maxRetries = networkParams?.maxRetries || 3;
  const timeout = networkParams?.timeout || 30000;

  const chunk_md5s: string[] = [];
  // 1. 计算所有分片的md5
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(fileBuffer.byteLength, start + chunkSize);
    const chunk = fileBuffer.slice(start, end);
    const chunkMd5 = SparkMD5.ArrayBuffer.hash(chunk);
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
      maxRetries,
      timeout
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

        await fetchWithRetry(
          "http://localhost:3000/api/file/upload",
          {
            method: "POST",
            body: formData,
          },
          maxRetries,
          timeout
        );

        // 更新进度
        totalUploadedChunks++;
        const progress = Math.round((totalUploadedChunks / chunkCount) * 100);

        self.postMessage({
          type: "progress",
          progress: progress,
          chunkIndex: i,
        });
      };
    });

    // 使用并发控制函数执行上传任务
    const result = await runWithConcurrency(uploadTasks, chunkConcurrency);

    // 报告上传结果
    self.postMessage({
      type: "uploadResult",
      completed: result.completed,
      failed: result.failed,
      failedIndices: result.failedIndices,
      totalChunks: needUploadChunks.length,
    });

    // 如果有失败的分片，则不进行合并
    if (result.failed > 0) {
      self.postMessage({
        type: "error",
        message: `有 ${result.failed} 个分片上传失败，请重试上传`,
        failedChunks: result.failedIndices,
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
      maxRetries,
      timeout
    );

    self.postMessage({ type: "done" });
  } catch (error) {
    // 上传过程中出现致命错误
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
