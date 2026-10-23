const fs = require("fs");
const path = require("path");
const { File, FileChunk, sequelize } = require("../models");
const { TMP_UPLOAD_DIR, UPLOADS_DIR, ensureDir } = require("../config/paths");
const { md5Buffer, md5File } = require("../utils/hash");
const {
  sanitizeFileId,
  parseChunkKey,
  sanitizeFilename,
  buildChunkPath,
} = require("../utils/fileSecurity");
const { generateThumbnail } = require("../utils/thumbnail");
const {
  enqueueChunkState,
  flushFileChunkStates,
  getPendingChunkStates,
  dropPendingChunkIndexes,
} = require("../services/chunkStateQueue");
const {
  isSqliteBusyError,
  withSqliteBusyRetry,
} = require("../utils/sqliteRetry");

const jsonError = (res, statusCode, message, data = {}) =>
  res.status(statusCode).json({ code: statusCode, message, data });

const jsonOk = (res, data = {}) => res.json({ code: 200, message: "ok", data });

const httpError = (statusCode, message, details = undefined) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  return error;
};

const mergeLocks = new Map();

const acquireMergeLock = (mergeKey) => {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  mergeLocks.set(mergeKey, { promise, release });
  return () => {
    const current = mergeLocks.get(mergeKey);
    if (current) {
      mergeLocks.delete(mergeKey);
      current.release();
    }
  };
};

const detectFileType = async (filePath) => {
  try {
    const { fileTypeFromFile } = await import("file-type");
    return await fileTypeFromFile(filePath);
  } catch {
    return null;
  }
};

const buildStoredFileName = (safeFileId, md5, safeName) => {
  const ext = path.extname(safeName);
  if (!ext) {
    return `${safeFileId}_${md5}`;
  }
  return `${safeFileId}_${md5}${ext}`;
};

const buildThumbnailName = (storedFileName) => {
  const ext = path.extname(storedFileName);
  if (!ext) {
    return `${storedFileName}_thumb`;
  }
  const base = storedFileName.slice(0, -ext.length);
  return `${base}_thumb${ext}`;
};

const reconcileChunksWithDisk = async (fileId, chunks) => {
  const availableChunks = [];
  const staleChunkIndexes = [];

  for (const chunk of chunks) {
    const chunkPath = buildChunkPath(fileId, chunk.chunk_index);
    if (fs.existsSync(chunkPath)) {
      availableChunks.push(chunk);
    } else {
      staleChunkIndexes.push(chunk.chunk_index);
    }
  }

  if (staleChunkIndexes.length > 0) {
    await withSqliteBusyRetry(() =>
      FileChunk.update(
        { status: 0 },
        {
          where: {
            file_id: fileId,
            status: 1,
            chunk_index: staleChunkIndexes,
          },
        }
      )
    );
    dropPendingChunkIndexes(fileId, staleChunkIndexes);
  }

  return availableChunks;
};

const buildChunkMap = (fileId, dbChunks) => {
  const chunkMap = new Map(dbChunks.map((chunk) => [chunk.chunk_index, chunk]));
  const pendingChunks = getPendingChunkStates(fileId);

  for (const chunk of pendingChunks) {
    if (chunk.status !== 1) {
      continue;
    }
    const chunkPath = buildChunkPath(fileId, chunk.chunk_index);
    if (!fs.existsSync(chunkPath)) {
      dropPendingChunkIndexes(fileId, [chunk.chunk_index]);
      continue;
    }
    chunkMap.set(chunk.chunk_index, chunk);
  }

  return chunkMap;
};

/**
 * 清空某个分片键下的旧分片结果（FileChunk 置无效 + 删除 tmp 分片文件）。
 * 用于 chunkSize/size 变更后旧分片不再可用的场景（P1-6）。
 */
const resetChunkResults = async (fileId) => {
  // 分片状态经异步队列落库，先把队列刷进 DB 再清理，避免漏删已入队分片
  await flushFileChunkStates(fileId);

  const dbChunks = await withSqliteBusyRetry(() =>
    FileChunk.findAll({
      where: { file_id: fileId, status: 1 },
    })
  );

  const staleChunkIndexes = [];
  for (const chunk of dbChunks) {
    const chunkPath = buildChunkPath(fileId, chunk.chunk_index);
    if (fs.existsSync(chunkPath)) {
      await fs.promises.unlink(chunkPath).catch(() => undefined);
    }
    staleChunkIndexes.push(chunk.chunk_index);
  }

  if (staleChunkIndexes.length > 0) {
    await withSqliteBusyRetry(() =>
      FileChunk.update(
        { status: 0 },
        {
          where: {
            file_id: fileId,
            status: 1,
            chunk_index: staleChunkIndexes,
          },
        }
      )
    );
    dropPendingChunkIndexes(fileId, staleChunkIndexes);
  }

  return staleChunkIndexes.length;
};

exports.instantCheck = async (req, res) => {
  try {
    const { file_id, md5, name, size, chunk_md5s, chunk_size } = req.body;
    const safeFileId = sanitizeFileId(file_id);

    if (!safeFileId || !md5 || !name || !size) {
      return jsonError(res, 400, "missing required parameters");
    }

    // 复合分片键（${md5}_${size}_${chunkSize}）与请求参数不一致时，
    // 说明 chunkSize/size 已变更（如网络自适应降级），旧分片不可复用，
    // 清空旧结果让客户端按新分片方案重传（P1-6）。
    const parsedKey = parseChunkKey(safeFileId);
    if (
      parsedKey &&
      (parsedKey.size !== Number(size) ||
        (chunk_size !== undefined && parsedKey.chunkSize !== Number(chunk_size)))
    ) {
      const cleared = await resetChunkResults(safeFileId);
      return jsonOk(res, {
        uploaded: false,
        chunkCheckResult: [],
        reset: true,
        clearedChunks: cleared,
      });
    }

    // 秒传判定按 md5+size：file_id 含 chunkSize 会随网络自适应变化，
    // 不能作为秒传键（P1-6/P1-7）。
    const file = await File.findOne({
      where: { md5, size, status: 1 },
    });

    if (file) {
      return jsonOk(res, { uploaded: true, file });
    }

    let chunkCheckResult = [];
    if (Array.isArray(chunk_md5s) && chunk_md5s.length > 0) {
      const dbChunks = await withSqliteBusyRetry(() =>
        FileChunk.findAll({
          where: { file_id: safeFileId, status: 1 },
        })
      );
      const chunks = await reconcileChunksWithDisk(safeFileId, dbChunks);
      const chunkMap = buildChunkMap(safeFileId, chunks);
      chunkCheckResult = chunk_md5s.map((chunkMd5, idx) => {
        const chunk = chunkMap.get(idx);
        return {
          index: idx,
          exist: Boolean(chunk),
          match: chunk ? chunk.chunk_md5 === chunkMd5 : false,
        };
      });
    }

    return jsonOk(res, { uploaded: false, chunkCheckResult });
  } catch (error) {
    if (isSqliteBusyError(error)) {
      return jsonError(res, 503, "database is busy, please retry later");
    }
    return jsonError(res, 500, error.message);
  }
};

exports.statusQuery = async (req, res) => {
  try {
    const { file_id, md5 } = req.query;
    const safeFileId = sanitizeFileId(file_id);

    if (!safeFileId || !md5) {
      return jsonError(res, 400, "missing required parameters");
    }

    const dbChunks = await withSqliteBusyRetry(() =>
      FileChunk.findAll({
        where: { file_id: safeFileId, status: 1 },
        order: [["chunk_index", "ASC"]],
      })
    );
    const chunks = await reconcileChunksWithDisk(safeFileId, dbChunks);
    const chunkMap = buildChunkMap(safeFileId, chunks);
    const chunkIndexes = Array.from(chunkMap.keys()).sort((a, b) => a - b);

    return jsonOk(res, {
      chunks: chunkIndexes,
    });
  } catch (error) {
    if (isSqliteBusyError(error)) {
      return jsonError(res, 503, "database is busy, please retry later");
    }
    return jsonError(res, 500, error.message);
  }
};

exports.uploadChunk = async (req, res) => {
  try {
    let { file_id, index, user_id, chunk_md5 } = req.body;
    const safeFileId = sanitizeFileId(file_id);

    if (!safeFileId || index === undefined) {
      return jsonError(res, 400, "missing required parameters");
    }
    if (!req.file || !req.file.buffer) {
      return jsonError(res, 400, "missing chunk file");
    }

    index = Number.parseInt(index, 10);
    if (Number.isNaN(index)) {
      return jsonError(res, 400, "index must be an integer");
    }

    ensureDir(TMP_UPLOAD_DIR);
    const chunkPath = buildChunkPath(safeFileId, index);
    const chunkMd5 = md5Buffer(req.file.buffer);
    if (chunk_md5 && chunk_md5 !== chunkMd5) {
      return jsonError(res, 400, "chunk md5 mismatch", {
        index,
        expected: chunk_md5,
        actual: chunkMd5,
      });
    }

    await fs.promises.writeFile(chunkPath, req.file.buffer);

    enqueueChunkState({
      file_id: safeFileId,
      chunk_index: index,
      status: 1,
      user_id: user_id || "test",
      upload_time: new Date(),
      chunk_md5: chunk_md5 || chunkMd5,
    });

    return jsonOk(res);
  } catch (error) {
    if (isSqliteBusyError(error)) {
      return jsonError(res, 503, "database is busy, please retry later");
    }
    return jsonError(res, 500, error.message);
  }
};

exports.mergeChunks = async (req, res) => {
  let transaction = null;
  let targetPath = "";
  let releaseMergeLock = () => undefined;

  try {
    ensureDir(TMP_UPLOAD_DIR);
    ensureDir(UPLOADS_DIR);

    const { file_id, md5, name, size, total, user_id, category_id } = req.body;
    const safeFileId = sanitizeFileId(file_id);
    const safeName = sanitizeFilename(name);

    if (!safeFileId || !md5 || !safeName || !size || !total) {
      return jsonError(res, 400, "missing required parameters");
    }

    const totalChunks = Number.parseInt(total, 10);
    if (Number.isNaN(totalChunks) || totalChunks <= 0) {
      return jsonError(res, 400, "total must be a positive integer");
    }

    const mergeKey = `${safeFileId}:${md5}`;
    const inFlight = mergeLocks.get(mergeKey);
    if (inFlight) {
      await inFlight.promise;
      const mergedFile = await withSqliteBusyRetry(() =>
        File.findOne({
          where: { md5, size, status: 1 },
        })
      );
      if (mergedFile) {
        return jsonOk(res, { alreadyMerged: true, file: mergedFile });
      }
      return jsonError(res, 503, "file is being merged, please retry later");
    }
    releaseMergeLock = acquireMergeLock(mergeKey);

    await flushFileChunkStates(safeFileId);

    // 秒传/已合并检查从事务内移到事务外：与 DB 的交互保持短事务，
    // 避免大文件合并的 readFile/appendFile/md5File IO 长时间持锁
    // 导致并发合并触发 SQLITE_BUSY（P1-13a）。
    const existingFile = await withSqliteBusyRetry(() =>
      File.findOne({
        where: { md5, size, status: 1 },
      })
    );
    if (existingFile) {
      return jsonOk(res, { alreadyMerged: true, file: existingFile });
    }

    const dbChunks = await withSqliteBusyRetry(() =>
      FileChunk.findAll({
        where: { file_id: safeFileId, status: 1 },
      })
    );
    const chunkMap = new Map(dbChunks.map((chunk) => [chunk.chunk_index, chunk]));

    const storedFileName = buildStoredFileName(safeFileId, md5, safeName);
    targetPath = path.join(UPLOADS_DIR, storedFileName);
    await fs.promises.writeFile(targetPath, Buffer.alloc(0));

    for (let i = 0; i < totalChunks; i += 1) {
      const chunkPath = buildChunkPath(safeFileId, i);
      if (!fs.existsSync(chunkPath)) {
        throw httpError(400, `chunk ${i} not found`);
      }

      const chunkBuffer = await fs.promises.readFile(chunkPath);
      const chunkMd5 = md5Buffer(chunkBuffer);
      const dbChunk = chunkMap.get(i);

      if (!dbChunk) {
        throw httpError(400, `chunk ${i} not found in database`);
      }
      if (dbChunk.chunk_md5 && dbChunk.chunk_md5 !== chunkMd5) {
        throw httpError(409, `chunk ${i} md5 does not match database`, {
          index: i,
          db_md5: dbChunk.chunk_md5,
          real_md5: chunkMd5,
        });
      }

      await fs.promises.appendFile(targetPath, chunkBuffer);
      await fs.promises.unlink(chunkPath);
    }

    const mergedMd5 = await md5File(targetPath);
    if (mergedMd5 !== md5) {
      throw httpError(422, "file md5 verification failed", {
        expected: md5,
        actual: mergedMd5,
      });
    }

    const fileTypeResult = await detectFileType(targetPath);
    const fileExt = fileTypeResult?.ext || path.extname(safeName).replace(".", "");
    const fileType = fileTypeResult?.mime || null;
    const filePath = path.posix.join("uploads", storedFileName);

    let thumbnailPath = null;
    if (fileType && fileType.startsWith("image/")) {
      const thumbName = buildThumbnailName(storedFileName);
      const thumbAbsolutePath = path.join(UPLOADS_DIR, thumbName);
      try {
        await generateThumbnail(targetPath, thumbAbsolutePath, {
          width: 200,
          height: 200,
        });
        thumbnailPath = path.posix.join("uploads", thumbName);
      } catch {
        thumbnailPath = null;
      }
    }

    // 重 IO 全部完成后再开短事务写库：File upsert + 分片状态归档一次提交
    transaction = await sequelize.transaction();
    try {
      await withSqliteBusyRetry(() =>
        File.upsert(
          {
            file_id: safeFileId,
            file_name: safeName,
            size,
            user_id: user_id || "test",
            status: 1,
            md5,
            category_id: category_id || 1,
            file_ext: fileExt,
            file_type: fileType,
            file_path: filePath,
            thumbnail_path: thumbnailPath,
          },
          { transaction }
        )
      );

      await withSqliteBusyRetry(() =>
        FileChunk.update(
          { status: 2 },
          { where: { file_id: safeFileId }, transaction }
        )
      );

      await transaction.commit();
      transaction = null;
    } catch (dbError) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
        transaction = null;
      }
      throw dbError;
    }

    return jsonOk(res);
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }

    if (targetPath && fs.existsSync(targetPath)) {
      await fs.promises.unlink(targetPath).catch(() => undefined);
    }

    const statusCode = isSqliteBusyError(error)
      ? 503
      : Number.isInteger(error.statusCode)
      ? error.statusCode
      : 500;
    const message = isSqliteBusyError(error)
      ? "database is busy, please retry later"
      : error.message;
    return jsonError(res, statusCode, message, error.details || {});
  } finally {
    releaseMergeLock();
  }
};
