/**
 * 格式化文件大小（上传/下载链路共用）。
 * @param size 字节数
 * @returns 格式化后的文件大小字符串，非法输入返回 "-"
 */
export const formatFileSize = (size: number): string => {
  if (!Number.isFinite(size) || size < 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};
