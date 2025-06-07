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
 * 创建下载URL
 * @param {string} fileId 文件ID
 * @returns {string} 下载URL
 */
export const createDownloadUrl = (fileId) => {
  return `${apiClient.defaults.baseURL}/api/file/download/${fileId}`;
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

export default {
  getFileList,
  createDownloadUrl,
  getDownloadFiles,
};
