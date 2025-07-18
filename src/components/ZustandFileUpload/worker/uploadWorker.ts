import SparkMD5 from "spark-md5";

// 调试日志函数
function debug(message: string, data?: Record<string, unknown>): void {
  console.log(`[UploadWorker] ${message}`, data || "");
  // 同时发送日志消息到主线程
  self.postMessage({
    type: "debug",
    message,
    data,
  });
}

// 使用 spark-md5 计算文件哈希
function calculateMD5(buffer: ArrayBuffer): string {
  debug("开始计算MD5");
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(buffer);
  const result = spark.end();
  debug("MD5计算完成", { result });
  return result;
}

// 使用 async.retry 进行带重试的请求
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
  debug(`开始请求: ${url}`, { method: options.method, maxRetries });

  return new Promise<Response>((resolve, reject) => {
    // 自定义重试逻辑，不使用async库
    let attempts = 0;

    const makeRequest = async () => {
      // 如果超过最大重试次数，则拒绝
      if (attempts >= maxRetries) {
        const error = new Error(`已达到最大重试次数: ${maxRetries}`);
        debug(`请求最终失败: ${url}`, { error: error.message, maxRetries });
        self.postMessage({
          type: "retry",
          error: error.message,
          attemptNumber: maxRetries,
          retriesLeft: 0,
          message: `已达到最大重试次数(${maxRetries}次)，上传失败`,
        });
        reject(error);
        return;
      }

      attempts++;
      const currentAttempt = attempts;

      try {
        // 创建 AbortController 用于超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          debug(`请求超时: ${url}`, { timeout, attempt: currentAttempt });
          controller.abort();
        }, timeout);

        debug(`执行请求: ${url} (尝试 ${currentAttempt}/${maxRetries})`, {
          method: options.method,
          headers: options.headers
            ? JSON.stringify(options.headers)
            : undefined,
          bodyType: options.body ? typeof options.body : undefined,
        });

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        debug(`请求完成: ${url} (尝试 ${currentAttempt}/${maxRetries})`, {
          status: response.status,
          statusText: response.statusText,
        });

        if (!response.ok) {
          let errorText = "";
          try {
            errorText = await response.text();
          } catch {
            debug("无法读取错误响应内容");
          }

          const error = new Error(
            `HTTP 错误 ${response.status}: ${response.statusText}`
          );
          debug(`请求失败: ${url} (尝试 ${currentAttempt}/${maxRetries})`, {
            status: response.status,
            statusText: response.statusText,
            errorText: errorText.substring(0, 200),
          });

          // 判断是否需要重试
          const isServerError = response.status >= 500;
          if (isServerError && attempts < maxRetries) {
            const nextRetryDelay = retryInterval * currentAttempt;
            debug(`将在 ${nextRetryDelay}ms 后重试请求`);
            setTimeout(makeRequest, nextRetryDelay);
            return;
          }

          reject(error);
          return;
        }

        // 请求成功
        debug(`请求成功: ${url} (尝试 ${currentAttempt}/${maxRetries})`);
        resolve(response);
      } catch (error) {
        const wrappedError =
          error instanceof Error ? error : new Error(String(error));
        debug(`请求异常: ${url} (尝试 ${currentAttempt}/${maxRetries})`, {
          error: wrappedError.message,
        });

        // 判断是否需要重试
        const isNetworkError =
          wrappedError.name === "TypeError" ||
          wrappedError.message.includes("network");
        const isTimeoutError =
          wrappedError.name === "AbortError" ||
          wrappedError.message.includes("timeout");

        if ((isNetworkError || isTimeoutError) && attempts < maxRetries) {
          const nextRetryDelay = retryInterval * currentAttempt;
          debug(`将在 ${nextRetryDelay}ms 后重试请求`);
          setTimeout(makeRequest, nextRetryDelay);
          return;
        }

        reject(wrappedError);
      }
    };

    // 开始第一次请求
    makeRequest();
  });
}

self.onmessage = async (event: MessageEvent) => {
  try {
    debug("Worker 收到消息", { type: event.data.type });

    // 只处理上传类型的消息
    if (event.data.type !== "upload") {
      debug("未知的消息类型", { type: event.data.type });
      return;
    }

    const { fileInfo, fileBuffer, networkParams, uploadConfig } = event.data;

    // 检查必要参数
    if (!fileInfo) {
      debug("缺少文件信息", event.data);
      throw new Error("缺少必要参数：fileInfo");
    }

    if (!fileBuffer) {
      debug("缺少文件数据", {
        fileId: fileInfo?.id,
        fileName: fileInfo?.fileName,
      });
      throw new Error("缺少必要参数：fileBuffer");
    }

    debug("文件信息", {
      fileName: fileInfo.fileName,
      fileSize: fileInfo.fileSize,
      hash: fileInfo.hash,
    });

    const chunkSize = fileInfo.chunkSize || 1024 * 1024;
    const chunkCount = Math.ceil(fileBuffer.byteLength / chunkSize);
    debug("分片信息", {
      chunkSize,
      chunkCount,
      totalSize: fileBuffer.byteLength,
    });

    // 使用网络参数中的分片并发数和重试参数
    const chunkConcurrency = networkParams?.chunkConcurrency || 2;
    const retryOptions = {
      maxRetries: networkParams?.maxRetries || 3,
      timeout: networkParams?.timeout || 30000,
      retryInterval: networkParams?.retryInterval || 1000,
    };
    debug("网络参数", { chunkConcurrency, ...retryOptions });

    const chunk_md5s: string[] = [];
    // 1. 计算所有分片的md5
    debug("开始计算所有分片MD5");
    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(fileBuffer.byteLength, start + chunkSize);
      const chunk = fileBuffer.slice(start, end);
      debug(`计算分片 ${i + 1}/${chunkCount} MD5`, {
        start,
        end,
        size: end - start,
      });
      const chunkMd5 = calculateMD5(chunk);
      chunk_md5s.push(chunkMd5);
    }
    debug("分片MD5计算完成", { count: chunk_md5s.length });

    // 2. 秒传确认
    try {
      debug("开始秒传确认");

      // 构建请求体
      const requestBody = {
        file_id: fileInfo.hash,
        md5: fileInfo.hash,
        name: fileInfo.fileName,
        size: fileInfo.fileSize,
        total: chunkCount,
        chunk_md5s,
      };
      debug("秒传请求体", requestBody);

      // 使用配置的 API 地址
      const baseURL = uploadConfig?.baseURL || "http://localhost:3000";
      const checkApi = uploadConfig?.checkApi || "/api/file/instant";
      const apiUrl = `${baseURL}${checkApi}`;
      debug(`使用API地址: ${apiUrl}`);

      const instantRes = await fetchWithRetry(
        apiUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        },
        retryOptions
      );

      debug("秒传确认响应", { status: instantRes.status });

      // 尝试解析响应
      let instantData;
      try {
        instantData = await instantRes.json();
        debug("秒传确认数据", instantData);
      } catch (error) {
        debug("解析秒传响应失败", { error: String(error) });
        throw new Error("解析秒传响应失败: " + String(error));
      }

      if (instantData.data?.uploaded) {
        debug("文件已秒传", { fileName: fileInfo.fileName });
        self.postMessage({ type: "done", skipped: true });
        return;
      }

      // 确定需要上传的分片
      const needUploadChunks: number[] = [];
      if (
        instantData.data?.chunkCheckResult &&
        Array.isArray(instantData.data.chunkCheckResult)
      ) {
        debug("使用服务器返回的分片检查结果");
        for (let i = 0; i < chunkCount; i++) {
          const exist = instantData.data.chunkCheckResult.find(
            (c: { index: number; exist: boolean }) => c.index === i
          )?.exist;
          if (!exist) needUploadChunks.push(i);
        }
      } else {
        debug("服务器未返回分片检查结果，上传所有分片");
        // 如果没有分片检查结果，则上传所有分片
        for (let i = 0; i < chunkCount; i++) {
          needUploadChunks.push(i);
        }
      }
      debug("需要上传的分片", {
        count: needUploadChunks.length,
        chunks: needUploadChunks,
      });

      // 记录已完成的分片数量，用于计算进度
      const completedChunks = chunkCount - needUploadChunks.length;
      let totalUploadedChunks = completedChunks;
      const failedChunks: number[] = [];

      // 3. 分片上传 - 使用并发控制
      if (needUploadChunks.length > 0) {
        debug("开始分片上传");
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

            debug(`上传分片 ${i + 1}/${chunkCount}`, { size: end - start });
            try {
              // 使用配置的上传 API 地址
              const uploadApi = uploadConfig?.uploadApi || "/api/file/upload";
              const uploadUrl = `${baseURL}${uploadApi}`;
              debug(`分片上传URL: ${uploadUrl}`);

              await fetchWithRetry(
                uploadUrl,
                {
                  method: "POST",
                  body: formData,
                },
                retryOptions
              );

              // 更新进度
              totalUploadedChunks++;
              const progress = Math.round(
                (totalUploadedChunks / chunkCount) * 100
              );
              debug(`分片 ${i + 1} 上传成功，总进度: ${progress}%`);

              self.postMessage({
                type: "progress",
                progress: progress,
                chunkIndex: i,
              });
            } catch (error) {
              // 记录失败的分片
              failedChunks.push(i);
              debug(`分片 ${i + 1} 上传失败`, {
                error: error instanceof Error ? error.message : String(error),
              });
              console.error(`分片 ${i + 1} 上传失败:`, error);
              throw error;
            }
          };
        });

        // 使用并发控制函数执行上传任务
        debug("执行并发上传任务", {
          tasks: uploadTasks.length,
          concurrency: chunkConcurrency,
        });
        await runWithConcurrency(uploadTasks, chunkConcurrency);
        debug("并发上传任务完成", { failedChunks: failedChunks.length });

        // 如果有失败的分片，报告错误
        if (failedChunks.length > 0) {
          debug("有分片上传失败", {
            count: failedChunks.length,
            chunks: failedChunks,
          });
          self.postMessage({
            type: "error",
            message: `有 ${failedChunks.length} 个分片上传失败，请重试上传`,
            failedChunks: failedChunks,
          });
          return;
        }
      } else {
        debug("没有需要上传的分片");
      }

      // 4. 合并
      debug("开始合并文件");
      const mergeRequestBody = {
        file_id: fileInfo.hash,
        md5: fileInfo.hash,
        name: fileInfo.fileName,
        size: fileInfo.fileSize,
        total: chunkCount,
      };
      debug("合并请求体", mergeRequestBody);

      const mergeUrl = "http://localhost:3000/api/file/merge";
      debug(`合并文件URL: ${mergeUrl}`);

      await fetchWithRetry(
        mergeUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mergeRequestBody),
        },
        retryOptions
      );
      debug("文件合并成功");

      self.postMessage({ type: "done", skipped: false });
    } catch (error) {
      // 上传过程中出现致命错误
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      debug("上传过程中出现致命错误", { error: errorMessage });
      self.postMessage({
        type: "error",
        message: errorMessage,
      });
    }
  } catch (error) {
    // Worker 执行过程中的全局错误处理
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug("Worker 执行错误", { error: errorMessage });
    self.postMessage({
      type: "error",
      message: errorMessage,
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

  debug("开始并发控制", { tasks: tasks.length, concurrency });

  return new Promise((resolve) => {
    // 启动初始任务
    const startNext = () => {
      // 如果所有任务都完成了，解析 Promise
      if (taskIndex >= tasks.length && running === 0) {
        debug("并发任务全部完成", { completed, failed });
        resolve({ completed, failed, failedIndices });
        return;
      }

      // 当有空闲并且还有任务时，启动新任务
      while (running < concurrency && taskIndex < tasks.length) {
        const currentIndex = taskIndex;
        const currentTask = tasks[taskIndex++];
        running++;
        debug(
          `启动任务 ${currentIndex + 1}/${tasks.length}，当前运行: ${running}`
        );

        currentTask()
          .then(() => {
            completed++;
            running--;
            debug(
              `任务 ${
                currentIndex + 1
              } 完成，剩余运行: ${running}，完成: ${completed}，失败: ${failed}`
            );
            startNext(); // 任务完成后，尝试启动下一个任务
          })
          .catch(() => {
            failed++;
            failedIndices.push(currentIndex);
            running--;
            debug(
              `任务 ${
                currentIndex + 1
              } 失败，剩余运行: ${running}，完成: ${completed}，失败: ${failed}`
            );
            startNext(); // 即使失败也尝试启动下一个任务
          });
      }
    };

    startNext();
  });
}
