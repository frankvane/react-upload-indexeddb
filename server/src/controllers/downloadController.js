const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { DOWNLOAD_DIR, UPLOADS_DIR, ensureDir } = require("../config/paths");
const { calculatePartialMd5Async } = require("../utils/hash");
const { File } = require("../models");

const fileIdCache = new Map();
const fileSystem = fs.promises;

// fileIdCache LRU 上限：Map 保持插入序，超限时淘汰最久未使用者
const FILE_ID_CACHE_MAX = 5000;

// 列表缓存：5s TTL + 源目录 mtime 签名。目录内文件增删会更新目录 mtime，
// 签名变化即失效，保证上传/删除后立即可见；内容不变时免除全目录扫描。
const LIST_CACHE_TTL_MS = Number(process.env.LIST_CACHE_TTL_MS) || 5000;
let listCache = { at: 0, files: null, signature: "" };
// 单飞：TTL 过期瞬间的并发请求共享同一次刷新，避免各自全量扫描（惊群）
let listRefresh = null;

const getSourceDirsSignature = async () => {
  const parts = [];
  for (const dirPath of [DOWNLOAD_DIR, UPLOADS_DIR]) {
    try {
      const stats = await fileSystem.stat(dirPath);
      parts.push(`${dirPath}:${stats.mtimeMs}`);
    } catch {
      parts.push(`${dirPath}:missing`);
    }
  }
  return parts.join("|");
};

const FILE_ID_PATTERN = /^[a-f0-9]{64}$/;

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
  if (
    duplicatedMatch &&
    duplicatedMatch[1].toLowerCase() === duplicatedMatch[2].toLowerCase()
  ) {
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

const buildCacheEntry = async (filePath, stats, options = {}) => {
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
  // LRU 淘汰：超上限先删最久未使用的 key
  if (fileIdCache.size >= FILE_ID_CACHE_MAX && !fileIdCache.has(filePath)) {
    const oldestKey = fileIdCache.keys().next().value;
    if (oldestKey !== undefined) {
      fileIdCache.delete(oldestKey);
    }
  }
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
      fileExt:
        plain.file_ext ||
        path.extname(plain.file_name || physicalName).replace(".", ""),
      fileType: plain.file_type || getFileType(plain.file_name || physicalName),
      thumbnailUrl: toUrlPath(plain.thumbnail_path),
      md5: plain.md5 || null,
      createdAt: plain.createdAt || plain.created_at || null,
    });

    if (plain.md5) {
      metadataByMd5.set(String(plain.md5).toLowerCase(), {
        fileName: plain.file_name || physicalName,
        fileExt:
          plain.file_ext ||
          path.extname(plain.file_name || physicalName).replace(".", ""),
        fileType:
          plain.file_type || getFileType(plain.file_name || physicalName),
        thumbnailUrl: toUrlPath(plain.thumbnail_path),
        md5: plain.md5 || null,
        createdAt: plain.createdAt || plain.created_at || null,
      });
    }
  }

  return { metadataMap, metadataByMd5 };
};

const collectAllFiles = async ({ force = false } = {}) => {
  const now = Date.now();
  const signature = await getSourceDirsSignature();
  if (
    !force &&
    listCache.files &&
    signature === listCache.signature &&
    now - listCache.at < LIST_CACHE_TTL_MS
  ) {
    return listCache.files;
  }

  if (listRefresh) {
    return listRefresh;
  }

  listRefresh = (async () => {
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

    // TTL 从扫描完成时刻起算，避免大目录扫描耗时挤占有效期
    listCache = { at: Date.now(), files, signature };
    return files;
  })().finally(() => {
    listRefresh = null;
  });

  return listRefresh;
};

const findFileById = async (fileId) => {
  for (const [filePath, info] of fileIdCache.entries()) {
    if (info.fileId !== fileId) continue;
    if (await readFileStats(filePath)) {
      // LRU：命中后移到最后（刷新使用序）
      fileIdCache.delete(filePath);
      fileIdCache.set(filePath, info);
      return {
        filePath,
        fileName: info.displayName || path.basename(filePath),
        md5: info.md5,
      };
    }
    fileIdCache.delete(filePath);
  }

  // 列表缓存新鲜则直接复用（不触发全量扫描）；过期才强制刷新一次。
  // 刷新后仍未命中即返回 null，不再循环全量扫描（P1-14）。
  const files = await collectAllFiles({
    force: Date.now() - listCache.at >= LIST_CACHE_TTL_MS,
  });
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
    const { search, page, pageSize } = req.query;
    let files = (await collectAllFiles()).map(({ filePath, ...rest }) => rest);

    if (search) {
      const keyword = String(search).toLowerCase();
      files = files.filter((file) =>
        file.fileName.toLowerCase().includes(keyword),
      );
    }

    // 分页参数可选：不传时全量返回（保持兼容）
    const total = files.length;
    const parsedPage = Number.parseInt(page, 10);
    const parsedPageSize = Number.parseInt(pageSize, 10);
    if (Number.isFinite(parsedPage) || Number.isFinite(parsedPageSize)) {
      const safePageSize =
        Number.isFinite(parsedPageSize) && parsedPageSize > 0
          ? Math.min(parsedPageSize, 200)
          : 50;
      const safePage =
        Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
      const start = (safePage - 1) * safePageSize;
      files = files.slice(start, start + safePageSize);

      return jsonOk(res, {
        total,
        page: safePage,
        pageSize: safePageSize,
        files,
      });
    }

    return jsonOk(res, {
      total,
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
    // 格式校验：合法 id 是 sha256 hex（64 位小写十六进制）。
    // 非法 id 直接 404，不做任何目录扫描（P1-14）。
    if (!FILE_ID_PATTERN.test(file_id)) {
      return jsonError(res, 404, "file not found");
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
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      // 客户端中断下载时销毁流，避免 fd 泄漏（P1-13e）
      const rangeStream = fs.createReadStream(filePath, { start, end });
      req.on("close", () => rangeStream.destroy());
      rangeStream.pipe(res);
      return;
    }

    res.setHeader("Content-Length", stats.size);
    res.setHeader("Content-Type", fileType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("ETag", `"${md5}"`);
    res.setHeader("Last-Modified", stats.mtime.toUTCString());
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );

    // 客户端中断下载时销毁流，避免 fd 泄漏（P1-13e）
    const fileStream = fs.createReadStream(filePath);
    req.on("close", () => fileStream.destroy());
    fileStream.pipe(res);
  } catch (error) {
    return jsonError(res, 500, error.message);
  }
};
