const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { DOWNLOAD_DIR, UPLOADS_DIR, ensureDir } = require("../config/paths");
const { calculatePartialMd5Async } = require("../utils/hash");
const { File } = require("../models");

const fileIdCache = new Map();
const fileSystem = fs.promises;

const jsonError = (res, statusCode, message, data = {}) =>
  res.status(statusCode).json({ code: statusCode, message, data });

const jsonOk = (res, data = {}) => res.json({ code: 200, message: "ok", data });

const getSourceDirs = () => {
  ensureDir(DOWNLOAD_DIR);
  ensureDir(UPLOADS_DIR);
  return [DOWNLOAD_DIR, UPLOADS_DIR];
};

const getFileType = (fileName) => {
  const detected = mime.lookup(fileName);
  return detected || "application/octet-stream";
};

const buildStableFileId = (filePath) =>
  crypto.createHash("sha256").update(path.resolve(filePath)).digest("hex");

const toUrlPath = (rawPath) => {
  if (!rawPath) return null;
  return `/${String(rawPath).replace(/\\/g, "/").replace(/^\/+/, "")}`;
};

const extractMd5FromHashedFilename = (name) => {
  if (!name || typeof name !== "string") {
    return null;
  }

  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  const directMatch = base.match(/^([a-f0-9]{32})$/i);
  if (directMatch) {
    return directMatch[1].toLowerCase();
  }

  const duplicatedMatch = base.match(/^([a-f0-9]{32})_([a-f0-9]{32})$/i);
  if (duplicatedMatch && duplicatedMatch[1].toLowerCase() === duplicatedMatch[2].toLowerCase()) {
    return duplicatedMatch[1].toLowerCase();
  }

  return null;
};

const readFileStats = async (filePath) => {
  try {
    const stats = await fileSystem.stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    return stats;
  } catch {
    return null;
  }
};

const buildCacheEntry = async (
  filePath,
  stats,
  options = {}
) => {
  const displayName = options.displayName || path.basename(filePath);
  const preferredMd5 = options.md5;
  const cached = fileIdCache.get(filePath);
  if (
    cached &&
    cached.mtime === stats.mtimeMs &&
    cached.displayName === displayName &&
    (!preferredMd5 || cached.md5 === preferredMd5)
  ) {
    return cached;
  }

  const entry = {
    fileId: buildStableFileId(filePath),
    md5: preferredMd5 || (await calculatePartialMd5Async(filePath, stats.size)),
    mtime: stats.mtimeMs,
    displayName,
  };
  fileIdCache.set(filePath, entry);
  return entry;
};

const buildUploadedMetadataMap = async () => {
  const metadataMap = new Map();
  const metadataByMd5 = new Map();
  const rows = await File.findAll({
    where: { status: 1 },
    attributes: [
      "file_name",
      "file_ext",
      "file_type",
      "file_path",
      "thumbnail_path",
      "md5",
      "created_at",
      "createdAt",
    ],
  });

  for (const row of rows) {
    const plain = row.get({ plain: true });
    if (!plain.file_path) continue;

    const physicalName = path.basename(plain.file_path);
    const absolutePath = path.resolve(path.join(UPLOADS_DIR, physicalName));

    metadataMap.set(absolutePath, {
      fileName: plain.file_name || physicalName,
      fileExt: plain.file_ext || path.extname(plain.file_name || physicalName).replace(".", ""),
      fileType: plain.file_type || getFileType(plain.file_name || physicalName),
      thumbnailUrl: toUrlPath(plain.thumbnail_path),
      md5: plain.md5 || null,
      createdAt: plain.createdAt || plain.created_at || null,
    });

    if (plain.md5) {
      metadataByMd5.set(String(plain.md5).toLowerCase(), {
        fileName: plain.file_name || physicalName,
        fileExt: plain.file_ext || path.extname(plain.file_name || physicalName).replace(".", ""),
        fileType: plain.file_type || getFileType(plain.file_name || physicalName),
        thumbnailUrl: toUrlPath(plain.thumbnail_path),
        md5: plain.md5 || null,
        createdAt: plain.createdAt || plain.created_at || null,
      });
    }
  }

  return { metadataMap, metadataByMd5 };
};

const collectAllFiles = async () => {
  const files = [];
  const { metadataMap, metadataByMd5 } = await buildUploadedMetadataMap();

  for (const dirPath of getSourceDirs()) {
    const names = await fileSystem.readdir(dirPath);
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const filePath = path.join(dirPath, name);
      const stats = await readFileStats(filePath);
      if (!stats) continue;
      const absolutePath = path.resolve(filePath);
      const uploadedMetadata =
        metadataMap.get(absolutePath) ||
        metadataByMd5.get(extractMd5FromHashedFilename(name));
      const displayName = uploadedMetadata?.fileName || name;

      const cacheEntry = await buildCacheEntry(filePath, stats, {
        displayName,
        md5: uploadedMetadata?.md5 || undefined,
      });
      files.push({
        id: cacheEntry.fileId,
        fileName: displayName,
        fileSize: stats.size,
        fileType: uploadedMetadata?.fileType || getFileType(displayName),
        fileExt:
          uploadedMetadata?.fileExt ||
          path.extname(displayName).replace(".", ""),
        url: `/api/file/download/${cacheEntry.fileId}`,
        thumbnailUrl: uploadedMetadata?.thumbnailUrl || null,
        createdAt: uploadedMetadata?.createdAt || stats.birthtime,
        md5: cacheEntry.md5,
        filePath,
      });
    }
  }

  return files;
};

const findFileById = async (fileId) => {
  for (const [filePath, info] of fileIdCache.entries()) {
    if (info.fileId !== fileId) continue;
    if (await readFileStats(filePath)) {
      return {
        filePath,
        fileName: info.displayName || path.basename(filePath),
        md5: info.md5,
      };
    }
    fileIdCache.delete(filePath);
  }

  const files = await collectAllFiles();
  const found = files.find((file) => file.id === fileId);
  if (!found) return null;

  return {
    filePath: found.filePath,
    fileName: found.fileName,
    md5: found.md5,
  };
};

exports.getFileList = async (req, res) => {
  try {
    const { search } = req.query;
    let files = (await collectAllFiles()).map(({ filePath, ...rest }) => rest);

    if (search) {
      const keyword = String(search).toLowerCase();
      files = files.filter((file) =>
        file.fileName.toLowerCase().includes(keyword)
      );
    }

    return jsonOk(res, {
      total: files.length,
      files,
    });
  } catch (error) {
    return jsonError(res, 500, error.message);
  }
};

exports.downloadFile = async (req, res) => {
  try {
    const { file_id } = req.params;
    if (!file_id) {
      return jsonError(res, 400, "missing file_id");
    }

    const found = await findFileById(file_id);
    if (!found) {
      return jsonError(res, 404, "file not found");
    }

    const { filePath, fileName, md5 } = found;
    const stats = await readFileStats(filePath);
    if (!stats) {
      return jsonError(res, 404, "file not found");
    }
    const fileType = getFileType(fileName);
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = Number.parseInt(parts[0], 10);
      const end = parts[1] ? Number.parseInt(parts[1], 10) : stats.size - 1;

      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start < 0 ||
        end < start ||
        end >= stats.size
      ) {
        return jsonError(res, 416, "invalid range", { fileSize: stats.size });
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", chunkSize);
      res.setHeader("Content-Type", fileType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      );
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.setHeader("Content-Length", stats.size);
    res.setHeader("Content-Type", fileType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("ETag", `"${md5}"`);
    res.setHeader("Last-Modified", stats.mtime.toUTCString());
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );

    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    return jsonError(res, 500, error.message);
  }
};
