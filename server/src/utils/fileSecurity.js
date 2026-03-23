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

const buildChunkPath = (fileId, index) => path.join(TMP_UPLOAD_DIR, `${fileId}_${index}`);

module.exports = {
  sanitizeFilename,
  sanitizeFileId,
  buildChunkPath,
};
