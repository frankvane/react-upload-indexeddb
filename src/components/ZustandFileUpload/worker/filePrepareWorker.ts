import SparkMD5 from "spark-md5";

/**
 * @enum {string}
 */
const UploadStatus = {
  QUEUED: "queued",
  QUEUED_FOR_UPLOAD: "queued-for-upload",
  CALCULATING: "calculating",
  PREPARING_UPLOAD: "preparing-upload",
  UPLOADING: "uploading",
  PAUSED: "paused",
  DONE: "done",
  INSTANT: "instant",
  ERROR: "error",
  MERGE_ERROR: "merge-error",
};

/**
 * @typedef {Object} NetworkParams
 * @property {number} chunkSize - 分片大小
 * @property {number} chunkConcurrency - 分片并发数
 * @property {number} fileConcurrency - 文件并发数
 * @property {string} networkType - 网络类型
 */

/**
 * @typedef {Object} UploadFile
 * @property {string} id
 * @property {string} fileName
 * @property {number} fileSize
 * @property {string} fileType
 * @property {number} lastModified
 * @property {string} status
 * @property {number} progress
 * @property {string=} hash
 * @property {number=} chunkSize
 * @property {number=} chunkCount
 * @property {number=} uploadedChunks
 * @property {number[]=} pausedChunks
 * @property {string=} errorMessage
 * @property {number} createdAt
 * @property {number} order
 * @property {ArrayBuffer=} buffer
 */

// 使用 spark-md5 计算文件哈希
function calculateMD5(buffer: ArrayBuffer): string {
  const spark = new SparkMD5.ArrayBuffer();
  spark.append(buffer);
  return spark.end();
}

self.onmessage = async (e) => {
  const files = e.data.files;
  // 从传入的网络参数中获取分片大小，如果没有则使用默认值
  const networkParams = e.data.networkParams || {};
  const CHUNK_SIZE = networkParams.chunkSize || 1024 * 1024; // 默认1MB

  // 记录处理进度
  let processed = 0;
  const total = files.length;
  let success = 0;
  let failed = 0;
  const oversized = 0;

  const uploadFiles = [];
  for (let i = 0; i < files.length; i++) {
    try {
      const file = files[i];
      const chunkSize = CHUNK_SIZE;
      const chunkCount = Math.ceil(file.size / chunkSize);

      // 发送进度更新
      processed++;
      self.postMessage({
        type: "progress",
        processed,
        total,
        success,
        failed,
        oversized,
      });

      const arrayBuffer = await file.arrayBuffer();
      const hash = calculateMD5(arrayBuffer);
      const id = hash;

      /** @type {UploadFile} */
      const uploadFile = {
        id,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        lastModified: file.lastModified,
        status: UploadStatus.QUEUED,
        progress: 0,
        hash,
        chunkSize,
        chunkCount,
        uploadedChunks: 0,
        pausedChunks: [],
        createdAt: Date.now(),
        order: i,
        buffer: arrayBuffer,
      };
      uploadFiles.push(uploadFile);
      success++;
    } catch (error) {
      console.error("Error processing file:", error);
      failed++;
    }
  }

  // 发送完成信息
  self.postMessage({
    type: "complete",
    uploadFiles,
    stats: {
      processed,
      total,
      success,
      failed,
      oversized,
    },
  });
};
