// @ts-expect-error: self 类型
importScripts("https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js");

declare const SparkMD5: {
  ArrayBuffer: { hash(buf: ArrayBuffer): string };
};

// 简单的并发控制函数
async function runWithConcurrency(
  tasks: (() => Promise<void>)[],
  concurrency: number
): Promise<void> {
  // 当前运行的任务数
  let running = 0;
  // 下一个要执行的任务索引
  let taskIndex = 0;

  return new Promise((resolve, reject) => {
    // 启动初始任务
    const startNext = () => {
      // 如果所有任务都完成了，解析 Promise
      if (taskIndex >= tasks.length && running === 0) {
        resolve();
        return;
      }

      // 当有空闲并且还有任务时，启动新任务
      while (running < concurrency && taskIndex < tasks.length) {
        const currentTask = tasks[taskIndex++];
        running++;

        currentTask()
          .then(() => {
            running--;
            startNext(); // 任务完成后，尝试启动下一个任务
          })
          .catch((error) => {
            reject(error); // 任何任务失败都会导致整个 Promise 被拒绝
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
  const instantRes = await fetch("http://localhost:3000/api/file/instant", {
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
  });
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

      await fetch("http://localhost:3000/api/file/upload", {
        method: "POST",
        body: formData,
      });

      // 更新进度
      totalUploadedChunks++;
      const progress = Math.round((totalUploadedChunks / chunkCount) * 100);

      self.postMessage({
        type: "progress",
        progress: progress,
      });
    };
  });

  // 使用并发控制函数执行上传任务
  await runWithConcurrency(uploadTasks, chunkConcurrency);

  // 4. 合并
  await fetch("http://localhost:3000/api/file/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: fileInfo.hash,
      md5: fileInfo.hash,
      name: fileInfo.fileName,
      size: fileInfo.fileSize,
      total: chunkCount,
    }),
  });

  self.postMessage({ type: "done" });
};
