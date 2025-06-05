import axios from "axios";

/**
 * 文件下载API客户端
 */
const apiClient = axios.create({
  baseURL: "http://localhost:3000",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * 获取可下载文件列表
 * @param {Object} params 查询参数
 * @returns {Promise} API响应
 */
export const getFileList = async (params = {}) => {
  try {
    const response = await apiClient.get("/api/file/list", { params });
    if (response.data.code === 200) {
      return response.data.data;
    }
    throw new Error(response.data.message || "获取文件列表失败");
  } catch (error) {
    console.error("获取文件列表失败:", error);
    throw error;
  }
};

/**
 * 获取文件信息
 * @param {string} fileId 文件ID
 * @returns {Promise} API响应
 */
export const getFileInfo = async (fileId) => {
  try {
    const response = await apiClient.get(`/api/file/info/${fileId}`);
    if (response.data.code === 200) {
      return response.data.data;
    }
    throw new Error(response.data.message || "获取文件信息失败");
  } catch (error) {
    console.error("获取文件信息失败:", error);
    throw error;
  }
};

/**
 * 获取下载信息（支持断点续传）
 * @param {string} fileId 文件ID
 * @returns {Promise} API响应
 */
export const getDownloadInfo = async (fileId) => {
  try {
    const response = await apiClient.get(`/api/file/download/${fileId}/info`);
    if (response.data.code === 200) {
      return response.data.data;
    }
    throw new Error(response.data.message || "获取下载信息失败");
  } catch (error) {
    console.error("获取下载信息失败:", error);
    throw error;
  }
};

/**
 * 创建下载URL
 * @param {string} fileId 文件ID
 * @returns {string} 下载URL
 */
export const createDownloadUrl = (fileId) => {
  return `${apiClient.defaults.baseURL}/api/file/download/${fileId}`;
};

/**
 * 创建分片下载URL
 * @param {string} fileId 文件ID
 * @param {number} index 分片索引
 * @param {number} chunkSize 分片大小
 * @returns {string} 分片下载URL
 */
export const createChunkDownloadUrl = (fileId, index, chunkSize) => {
  return `${apiClient.defaults.baseURL}/api/file/download/${fileId}/chunk/${index}?chunkSize=${chunkSize}`;
};

/**
 * 获取下载文件列表（格式化为ZustandFileDownload组件使用的格式）
 * @param {Object} params 查询参数
 * @returns {Promise<Array>} 文件列表
 */
export const getDownloadFiles = async (params = {}) => {
  try {
    const { files } = await getFileList(params);
    return files.map((file) => ({
      id: file.id,
      url: createDownloadUrl(file.id),
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.fileType,
      metadata: {
        fileExt: file.fileExt,
        thumbnailUrl: file.thumbnailUrl,
        md5: file.md5,
        createdAt: file.createdAt,
      },
    }));
  } catch (error) {
    console.error("获取下载文件列表失败:", error);
    throw error;
  }
};

/**
 * 检查文件是否支持断点续传
 * @param {string} fileId 文件ID
 * @returns {Promise<boolean>} 是否支持断点续传
 */
export const checkResumeSupport = async (fileId) => {
  try {
    const info = await getDownloadInfo(fileId);
    return info.supportsRanges === true;
  } catch (error) {
    console.error("检查断点续传支持失败:", error);
    return false;
  }
};

/**
 * 获取文件下载预处理信息
 * @param {string} fileId 文件ID
 * @returns {Promise} 预处理信息
 */
export const prepareDownload = async (fileId) => {
  try {
    const info = await getDownloadInfo(fileId);
    return {
      id: info.id,
      fileName: info.fileName,
      fileSize: info.fileSize,
      fileType: info.fileType,
      md5: info.md5,
      lastModified: info.lastModified,
      resumeSupported: info.supportsRanges,
      chunkSize: info.recommendedChunkSize,
      totalChunks: info.totalChunks,
      downloadUrl: info.urls.download,
      chunkUrl: info.urls.chunk,
      chunks: Array.from({ length: info.totalChunks }, (_, i) => ({
        index: i,
        start: i * info.recommendedChunkSize,
        end: Math.min(
          (i + 1) * info.recommendedChunkSize - 1,
          info.fileSize - 1
        ),
        size:
          i < info.totalChunks - 1
            ? info.recommendedChunkSize
            : info.fileSize - i * info.recommendedChunkSize,
        downloaded: 0,
        status: "QUEUED",
      })),
    };
  } catch (error) {
    console.error("准备下载失败:", error);
    throw error;
  }
};

export default {
  getFileList,
  getFileInfo,
  getDownloadInfo,
  createDownloadUrl,
  createChunkDownloadUrl,
  getDownloadFiles,
  checkResumeSupport,
  prepareDownload,
};
