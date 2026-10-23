const path = require("path");
const { TMP_UPLOAD_DIR } = require("../config/paths");

const sanitizeFilename = (inputName) => {
  const baseName = path.basename(String(inputName || ""));
  const sanitized = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return sanitized || `file-${Date.now()}`;
};

const sanitizeFileId = (fileId) =>
  String(fileId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * 解析新版复合分片键：`${md5}_${size}_${chunkSize}`（客户端 buildChunkKey 生成）。
 * 旧版纯 md5 键或自定义键返回 null（走兼容逻辑，不做一致性校验）。
 */
const parseChunkKey = (fileId) => {
  const match = /^([a-f0-9]{32})_(\d+)_(\d+)$/.exec(String(fileId || ""));
  if (!match) {
    return null;
  }
  return {
    md5: match[1],
    size: Number(match[2]),
    chunkSize: Number(match[3]),
  };
};

const buildChunkPath = (fileId, index) => path.join(TMP_UPLOAD_DIR, `${fileId}_${index}`);

module.exports = {
  sanitizeFilename,
  sanitizeFileId,
  parseChunkKey,
  buildChunkPath,
};
