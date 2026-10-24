/**
 * 下载业务策略（纯函数）：文件归一化与 worker 消息构造。
 *
 * 本文件不依赖 React、不持有 worker / store 引用、不产生副作用，仅做：
 *  - 分片大小/总分片数的归一化计算；
 *  - 由归一化结果与服务端地址、鉴权头拼装 START_DOWNLOAD / UPDATE_CONCURRENCY 消息。
 * 副作用（写 IndexedDB、postMessage、状态更新）由编排层负责。
 */

import type { DownloadFile } from "../types";
import * as apiClient from "../api.client";

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

export interface NormalizedDownload {
  normalizedFile: DownloadFile;
  finalChunkSize: number;
  calculatedTotalChunks: number;
  filePatch: Partial<DownloadFile>;
}

/** 根据文件已有分片配置与 store 默认分片大小，推导最终分片参数。 */
export function normalizeDownloadFile(
  file: DownloadFile,
  storeChunkSize: number
): NormalizedDownload {
  const finalChunkSize = file.chunkSize || storeChunkSize || DEFAULT_CHUNK_SIZE;
  const calculatedTotalChunks = Math.ceil(file.fileSize / finalChunkSize);

  const filePatch: Partial<DownloadFile> = {};
  if (!file.chunkSize || file.chunkSize !== finalChunkSize) {
    filePatch.chunkSize = finalChunkSize;
  }
  if (file.totalChunks !== calculatedTotalChunks) {
    filePatch.totalChunks = calculatedTotalChunks;
  }

  const normalizedFile =
    Object.keys(filePatch).length > 0 ? { ...file, ...filePatch } : file;

  return {
    normalizedFile,
    finalChunkSize,
    calculatedTotalChunks,
    filePatch,
  };
}

export interface StartDownloadMessageParams {
  fileId: string;
  fileSize: number;
  finalChunkSize: number;
  totalChunks: number;
  pendingChunks: number[];
  fileConcurrency: number;
  chunkConcurrency: number;
  authHeaders: Record<string, string>;
  withCredentials: boolean;
}

/** 构造 START_DOWNLOAD worker 消息（URL 由库内 apiClient 拼接）。 */
export function buildStartDownloadMessage(params: StartDownloadMessageParams) {
  return {
    type: "START_DOWNLOAD" as const,
    payload: {
      fileId: params.fileId,
      url: apiClient.createDownloadUrl(params.fileId),
      fileSize: params.fileSize,
      chunkSize: params.finalChunkSize,
      totalChunks: params.totalChunks,
      pendingChunks: params.pendingChunks,
      fileConcurrency: params.fileConcurrency,
      chunkConcurrency: params.chunkConcurrency,
      authHeaders: params.authHeaders,
      withCredentials: params.withCredentials,
    },
  };
}

/** 构造 UPDATE_CONCURRENCY worker 消息。 */
export function buildUpdateConcurrencyMessage(
  fileConcurrency: number,
  chunkConcurrency: number
) {
  return {
    type: "UPDATE_CONCURRENCY" as const,
    payload: {
      fileConcurrency,
      chunkConcurrency,
    },
  };
}
