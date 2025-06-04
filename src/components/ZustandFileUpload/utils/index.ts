/**
 * 字节单位转换
 * @param bytes 字节数
 * @returns 格式化后的字符串
 */
export const ByteConvert = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

/**
 * 生成唯一ID
 * @returns 唯一ID字符串
 */
export const generateUniqueId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
};

/**
 * 格式化时间戳为可读字符串
 * @param timestamp 时间戳
 * @returns 格式化后的时间字符串
 */
export const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

/**
 * 计算剩余时间
 * @param bytesUploaded 已上传字节数
 * @param bytesTotal 总字节数
 * @param elapsedTime 已用时间(毫秒)
 * @returns 剩余时间(秒)
 */
export const calculateRemainingTime = (
  bytesUploaded: number,
  bytesTotal: number,
  elapsedTime: number
): number => {
  if (bytesUploaded === 0) return 0;
  const bytesRemaining = bytesTotal - bytesUploaded;
  const uploadSpeed = bytesUploaded / elapsedTime; // 字节/毫秒
  return bytesRemaining / uploadSpeed / 1000; // 转换为秒
};
