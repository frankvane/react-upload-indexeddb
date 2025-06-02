// @ts-expect-error: self 类型
importScripts("https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js");

declare const SparkMD5: {
  ArrayBuffer: { hash(buf: ArrayBuffer): string };
};

self.onmessage = async (e) => {
  const { fileInfo, fileBuffer } = e.data;
  const chunkSize = fileInfo.chunkSize || 1024 * 1024;
  const chunkCount = Math.ceil(fileBuffer.byteLength / chunkSize);
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

  // 3. 分片上传
  for (let i = 0; i < chunkCount; i++) {
    if (!needUploadChunks.includes(i)) continue;
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

    self.postMessage({
      type: "progress",
      progress: Math.round(((i + 1) / chunkCount) * 100),
    });
  }

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
