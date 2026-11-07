const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const { DOWNLOAD_DIR, UPLOADS_DIR, ensureDir } = require("../config/paths");
const { calculatePartialMd5Async, getPartialMd5Mode } = require("../utils/hash");
const { redactErrorMessage } = require("../utils/errorMessage");
const { File } = require("../models");

const fileIdCache = new Map();
const fileSystem = fs.promises;

// fileIdCache LRU 上限：Map 保持插入序，超限时淘汰最久未使用者
const FILE_ID_CACHE_MAX = 5000;

// P2-9：身份只认鉴权中间件写入的 req.user（与 uploadController 保持一致）。
const getUserId = (req) =>
  req && req.user && req.user.id ? String(req.user.id) : "test";

// 列表缓存：5s TTL + 源目录 mtime 签名。目录内文件增删会更新目录 mtime，
// 签名变化即失效，保证上传/删除后立即可见；内容不变时免除全目录扫描。
// P2-9：缓存按用户隔离，不同用户可见的文件集合不同，不能共用一份。
const LIST_CACHE_TTL_MS = Number(process.env.LIST_CACHE_TTL_MS) || 5000;
const LIST_CACHE_MAX_USERS = 200;
const listCaches = new Map(); // userId -> { at, files, signature }
// 单飞：TTL 过期瞬间的并发请求共享同一次刷新，避免各自全量扫描（惊群）
const listRefreshByUser = new Map();

const setCachedList = (userId, value) => {
  if (listCaches.size >= LIST_CACHE_MAX_USERS && !listCaches.has(userId)) {
    const oldestKey = listCaches.keys().next().value;
    if (oldestKey !== undefined) {
      listCaches.delete(oldestKey);
    }
  }
  listCaches.set(userId, value);
};

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
    // P2-8：无 DB 元数据的大文件只能给出采样 md5，必须显式标记，
    // 否则客户端会把它当作全量 md5 做严格比对，>10MB 文件永远"校验失败"。
    md5Mode: preferredMd5 ? "full" : getPartialMd5Mode(stats.size),
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

const buildUploadedMetadataMap = async (userId) => {
  const metadataMap = new Map();
  const metadataByMd5 = new Map();
  // 所有用户已认领的物理路径：用于把「他人文件」从当前用户的列表中剔除。
  const claimedPaths = new Set();
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
      "user_id",
    ],
  });

  for (const row of rows) {
    const plain = row.get({ plain: true });
    if (!plain.file_path) continue;

    const physicalName = path.basename(plain.file_path);
    const absolutePath = path.resolve(path.join(UPLOADS_DIR, physicalName));
    claimedPaths.add(absolutePath);

    // P2-9：只把当前用户的元数据放进展示映射，他人行仅用于标记「已认领」。
    if (String(plain.user_id || "") !== String(userId)) continue;

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

  return { metadataMap, metadataByMd5, claimedPaths };
};

const collectAllFiles = async ({ force = false, userId = "test" } = {}) => {
  const cacheKey = String(userId);
  const now = Date.now();
  const signature = await getSourceDirsSignature();
  const cached = listCaches.get(cacheKey);
  if (
    !force &&
    cached &&
    cached.files &&
    signature === cached.signature &&
    now - cached.at < LIST_CACHE_TTL_MS
  ) {
    return cached.files;
  }

  if (listRefreshByUser.has(cacheKey)) {
    return listRefreshByUser.get(cacheKey);
  }

  const refresh = (async () => {
    const files = [];
    const { metadataMap, metadataByMd5, claimedPaths } =
      await buildUploadedMetadataMap(cacheKey);

    for (const dirPath of getSourceDirs()) {
      const names = await fileSystem.readdir(dirPath);
      for (const name of names) {
        if (name.startsWith(".")) continue;
        const filePath = path.join(dirPath, name);
        const stats = await readFileStats(filePath);
        if (!stats) continue;
        const absolutePath = path.resolve(filePath);
        const ownedMetadata = metadataMap.get(absolutePath);
        // P2-9：该物理文件已被其他用户认领 → 不出现在当前用户的列表里。
        if (claimedPaths.has(absolutePath) && !ownedMetadata) {
          continue;
        }
        const uploadedMetadata =
          ownedMetadata ||
          (claimedPaths.has(absolutePath)
            ? undefined
            : metadataByMd5.get(extractMd5FromHashedFilename(name)));
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
          // P2-8：full = 真实全量 md5（可做严格终检）；sample = 采样 md5（客户端须跳过严格比对）
          md5Mode: cacheEntry.md5Mode || "full",
          filePath,
        });
      }
    }

    // TTL 从扫描完成时刻起算，避免大目录扫描耗时挤占有效期
    setCachedList(cacheKey, { at: Date.now(), files, signature });
    return files;
  })().finally(() => {
    listRefreshByUser.delete(cacheKey);
  });

  listRefreshByUser.set(cacheKey, refresh);
  return refresh;
};

// P2-9：判断物理文件是否属于当前用户。
// uploads 下存在 DB 行时严格比对 user_id；无 DB 行的遗留 / 人工投放文件保持可见
// （与升级前行为一致）；downloads 目录不参与归属判断。
const isOwnedByUser = async (filePath, userId) => {
  const relative = path.relative(UPLOADS_DIR, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return true;
  }
  const relativePosix = relative.split(path.sep).join("/");
  const row = await File.findOne({
    where: { file_path: path.posix.join("uploads", relativePosix), status: 1 },
    attributes: ["user_id"],
  });
  if (!row) {
    return true;
  }
  return String(row.user_id) === String(userId);
};

const findFileById = async (fileId, userId = "test") => {
  for (const [filePath, info] of fileIdCache.entries()) {
    if (info.fileId !== fileId) continue;
    if (!(await readFileStats(filePath))) {
      fileIdCache.delete(filePath);
      continue;
    }
    // 他人文件按「不存在」处理，避免通过 id 探测文件是否存在。
    if (!(await isOwnedByUser(filePath, userId))) continue;
    // LRU：命中后移到最后（刷新使用序）
    fileIdCache.delete(filePath);
    fileIdCache.set(filePath, info);
    return {
      filePath,
      fileName: info.displayName || path.basename(filePath),
      md5: info.md5,
    };
  }

  // 列表缓存新鲜则直接复用（不触发全量扫描）；过期才强制刷新一次。
  // 刷新后仍未命中即返回 null，不再循环全量扫描（P1-14）。
  const cached = listCaches.get(String(userId));
  const files = await collectAllFiles({
    force: !cached || Date.now() - cached.at >= LIST_CACHE_TTL_MS,
    userId,
  });
  const found = files.find((file) => file.id === fileId);
  if (!found) return null;

  return {
    filePath: found.filePath,
    fileName: found.fileName,
    md5: found.md5,
  };
};

exports.downloadThumbnail = async (req, res) => {
  try {
    const { file_id } = req.params;
    if (!file_id) {
      return jsonError(res, 400, "missing file_id");
    }
    // 与 downloadFile 相同：非法 id 直接 404，不做目录扫描（P1-14）
    if (!FILE_ID_PATTERN.test(file_id)) {
      return jsonError(res, 404, "thumbnail not found");
    }

    const found = await findFileById(file_id, getUserId(req));
    if (!found || !found.filePath) {
      return jsonError(res, 404, "thumbnail not found");
    }

    // 缩略图与主文件同目录，命名规则与 uploadController.buildThumbnailName 一致：
    // `${baseNoExt}_thumb${ext}`。仅当实体存在且为图片时才返回。
    const dir = path.dirname(found.filePath);
    const base = path.basename(found.filePath);
    const ext = path.extname(base);
    const baseNoExt = ext ? base.slice(0, -ext.length) : base;
    const thumbName = ext ? `${baseNoExt}_thumb${ext}` : `${baseNoExt}_thumb`;
    const thumbPath = path.join(dir, thumbName);

    const stats = await readFileStats(thumbPath);
    if (!stats) {
      return jsonError(res, 404, "thumbnail not found");
    }

    const thumbType = getFileType(thumbName);
    if (!thumbType.startsWith("image/")) {
      return jsonError(res, 403, "not an image");
    }

    // 鉴权由 /api/file 上的 auth 中间件统一保障；此处仅以 inline 方式返回图片。
    res.setHeader("Content-Length", stats.size);
    res.setHeader("Content-Type", thumbType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(thumbName)}`,
    );
    const stream = fs.createReadStream(thumbPath);
    req.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    return jsonError(res, 500, redactErrorMessage(error));
  }
};

exports.getFileList = async (req, res) => {
  try {
    const { search, page, pageSize } = req.query;
    let files = (await collectAllFiles({ userId: getUserId(req) })).map(
      ({ filePath, ...rest }) => rest
    );

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
    return jsonError(res, 500, redactErrorMessage(error));
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

    const found = await findFileById(file_id, getUserId(req));
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
      // S11：仅支持单段 Range；多段（逗号分隔）显式拒绝，避免被误判为单段导致
      // 返回错误字节区间。标准响应 416 + Content-Range: bytes */size。
      if (range.includes(",")) {
        res.status(416);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Range", `bytes */${stats.size}`);
        return res.end();
      }

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
        // 非法 Range（超出文件范围 / 起点大于终点 / 负数等）一律返回标准 416，
        // 并带 Content-Range: bytes */size 告知客户端可用范围（与 S11 多段拒绝一致）。
        res.status(416);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Range", `bytes */${stats.size}`);
        return res.end();
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
    return jsonError(res, 500, redactErrorMessage(error));
  }
};
