import { UploadFile } from "../types/upload";
import {
  UploadWorkerRequest,
  UploadWorkerResponse,
} from "../types/workerProtocol";
// 内联 worker（见 useFileProcessor 注释）：避免发布后被消费方当作外部资产 404。
import UploadWorker from "../worker/uploadWorker.ts?worker&inline";
import { buildChunkKey } from "../../../shared/chunkKey";

interface UploadWorkerNetworkParams {
  networkType: string;
  fileConcurrency: number;
  chunkConcurrency: number;
  chunkSize: number;
  maxRetries: number;
}

interface UploadWorkerApiConfig {
  baseURL: string;
  uploadApi: string;
  checkApi: string;
  mergeApi: string;
  authHeaders?: Record<string, string>;
  withCredentials?: boolean;
}

interface RunUploadTaskOptions {
  file: UploadFile;
  fileBuffer: ArrayBuffer;
  networkParams: UploadWorkerNetworkParams;
  uploadConfig: UploadWorkerApiConfig;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onRetry?: (message: string) => void;
  onDebug?: (message: string, data?: Record<string, unknown>) => void;
}

interface UploadTaskResult {
  success: boolean;
  skipped: boolean;
  cancelled?: boolean;
  errorMessage?: string;
}

const createUploadWorker = () => new UploadWorker();

const workerPool = new Set<Worker>();
const idleWorkers: Worker[] = [];
/** fileId → 正在处理该文件的 Worker，供 cancelUploadTask 精确取消（P1-8） */
const taskWorkerMap = new Map<string, Worker>();

/** CANCEL 兜底时长：worker 无 cancelled 响应即强制终止 */
const CANCEL_FALLBACK_MS = 800;

const acquireUploadWorker = (): Worker => {
  const existingWorker = idleWorkers.pop();
  if (existingWorker) {
    return existingWorker;
  }

  const worker = createUploadWorker();
  workerPool.add(worker);
  return worker;
};

const releaseUploadWorker = (worker: Worker) => {
  if (!workerPool.has(worker)) {
    return;
  }

  if (!idleWorkers.includes(worker)) {
    idleWorkers.push(worker);
  }
};

const disposeUploadWorker = (worker: Worker) => {
  if (!workerPool.has(worker)) {
    return;
  }

  workerPool.delete(worker);
  const idleIndex = idleWorkers.indexOf(worker);
  if (idleIndex >= 0) {
    idleWorkers.splice(idleIndex, 1);
  }
  worker.terminate();
};

export const disposeUploadWorkerPool = () => {
  for (const worker of Array.from(workerPool)) {
    disposeUploadWorker(worker);
  }
  taskWorkerMap.clear();
};

/**
 * 取消指定文件的上传任务（P1-8）：
 * 1. 向 Worker 发送 CANCEL，内部 AbortController 中断在途 fetch 与重试；
 * 2. 兜底：若 CANCEL_FALLBACK_MS 内未收到 cancelled 响应（如 Worker 卡死），
 *    直接 terminate 该 Worker。
 */
export const cancelUploadTask = (fileId: string): void => {
  const worker = taskWorkerMap.get(fileId);
  if (!worker) {
    return;
  }

  worker.postMessage({ type: "cancel", fileId });

  setTimeout(() => {
    // cancelled 响应到达后 finish/cleanup 会将 fileId 从 map 移除；
    // 仍残留说明 worker 无响应，强制终止兜底
    if (taskWorkerMap.get(fileId) === worker) {
      taskWorkerMap.delete(fileId);
      disposeUploadWorker(worker);
    }
  }, CANCEL_FALLBACK_MS);
};

export const runUploadTask = async (
  options: RunUploadTaskOptions
): Promise<UploadTaskResult> => {
  if (options.signal?.aborted) {
    return {
      success: false,
      skipped: false,
      cancelled: true,
      errorMessage: "上传已取消",
    };
  }

  const worker = acquireUploadWorker();

  return new Promise<UploadTaskResult>((resolve) => {
    let settled = false;
    let shouldRecycleWorker = true;

    const finish = (result: UploadTaskResult) => {
      if (settled) {
        return;
      }
      settled = true;
      taskWorkerMap.delete(options.file.id);
      cleanup();
      resolve(result);
    };

    const handleAbort = () => {
      shouldRecycleWorker = false;
      taskWorkerMap.delete(options.file.id);

      if (settled) {
        // 任务已结束又收到取消（竞态）：仍需处置 worker 与监听，避免泄漏
        if (options.signal) {
          options.signal.removeEventListener("abort", handleAbort);
        }
        worker.onmessage = null;
        worker.onerror = null;
        disposeUploadWorker(worker);
        return;
      }

      finish({
        success: false,
        skipped: false,
        cancelled: true,
        errorMessage: "上传已取消",
      });
    };

    const cleanup = () => {
      if (options.signal) {
        options.signal.removeEventListener("abort", handleAbort);
      }
      worker.onmessage = null;
      worker.onerror = null;

      if (shouldRecycleWorker) {
        releaseUploadWorker(worker);
        return;
      }

      disposeUploadWorker(worker);
    };

    if (options.signal) {
      options.signal.addEventListener("abort", handleAbort, { once: true });
    }

    worker.onerror = (event) => {
      shouldRecycleWorker = false;
      const reason = event.message || "Upload worker failed";
      finish({ success: false, skipped: false, errorMessage: reason });
    };

    worker.onmessage = (event: MessageEvent<UploadWorkerResponse>) => {
      const payload = event.data;

      if (payload.type === "debug") {
        options.onDebug?.(payload.message, payload.data);
        return;
      }

      if (payload.type === "progress") {
        options.onProgress?.(payload.progress);
        return;
      }

      if (payload.type === "retry") {
        options.onRetry?.(payload.message ?? "retry");
        return;
      }

      if (payload.type === "done") {
        finish({
          success: true,
          skipped: Boolean(payload.skipped),
        });
        return;
      }

      if (payload.type === "error") {
        finish({
          success: false,
          skipped: false,
          errorMessage: payload.message ?? "Upload failed",
        });
        return;
      }

      if (payload.type === "cancelled") {
        // Worker 确认已中断该文件的在途请求
        finish({
          success: false,
          skipped: false,
          cancelled: true,
          errorMessage: "上传已取消",
        });
      }
    };

    taskWorkerMap.set(options.file.id, worker);

    const message: UploadWorkerRequest = {
      type: "upload",
      fileInfo: {
        id: options.file.id,
        fileName: options.file.fileName,
        fileSize: options.file.fileSize,
        hash: options.file.hash,
        chunkSize: options.file.chunkSize,
        // 分片存储键：chunkSize 变化（网络自适应）后新旧分片互不污染（P1-6）
        chunkKey: buildChunkKey(
          options.file.hash,
          options.file.fileSize,
          options.file.chunkSize
        ),
      },
      fileBuffer: options.fileBuffer,
      networkParams: options.networkParams,
      uploadConfig: options.uploadConfig,
    };

    worker.postMessage(message, [options.fileBuffer]);
  });
};
