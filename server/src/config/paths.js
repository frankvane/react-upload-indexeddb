const fs = require("fs");
const path = require("path");

const SERVER_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(SERVER_ROOT, "data");
const TMP_UPLOAD_DIR = path.join(SERVER_ROOT, "tmp", "upload");
const UPLOADS_DIR = path.join(SERVER_ROOT, "uploads");
const DOWNLOAD_DIR = path.join(SERVER_ROOT, "download");

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
};

const ensureBaseDirs = () => {
  [DATA_DIR, TMP_UPLOAD_DIR, UPLOADS_DIR, DOWNLOAD_DIR].forEach(ensureDir);
};

module.exports = {
  SERVER_ROOT,
  DATA_DIR,
  TMP_UPLOAD_DIR,
  UPLOADS_DIR,
  DOWNLOAD_DIR,
  ensureDir,
  ensureBaseDirs,
};
