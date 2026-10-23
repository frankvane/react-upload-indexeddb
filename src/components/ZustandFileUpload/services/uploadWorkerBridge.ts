import { UploadFile, type UploadHashMode } from "../types/upload";
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
  /** 调试日志开关（默认 false，关闭时 Worker 内不产生日志） */
  debug?: boolean;
  /** 文件哈希模式（T3.1）：sample 时服务端合并跳过全量 md5 强校验 */
  hashMode?: UploadHashMode;
}

interface RunUploadTaskOptions {
  file: UploadFile;
  /** 主线程文件引用（T3.1 流式分片）：File 结构化克隆进 Worker，按需 slice 读取 */
  fileRef: File;
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

export interface UploadWorkerPool {
  runUploadTask: (options: RunUploadTaskOptions) => Promise<UploadTaskResult>;
  cancelUploadTask: (fileId: string) => void;
  /** 释放本实例持有的全部 worker（组件卸载时调用） */
  dispose: () => void;
}

const createUploadWorker = () => new UploadWorker();

// CANCEL 兜底时长：worker 无 cancelled 响应即强制终止
const CANCEL_FALLBACK_MS = 800;

/**
 * 创建每实例上传 Worker 池（T3.2 单例治理）。
 *
 * 原实现为模块级单例池：所有 <FileUpload> 实例共享同一批 worker，卸载即
 * 全部 terminate，多实例互相干扰。现改为工厂，每个实例持有独立池，卸载时
 * 仅 dispose 自身持有的 worker（引用计数语义：池随实例生命周期）。
 */
export const createUploadWorkerPool = (): UploadWorkerPool => {
  const workerPool = new Set<Worker>();
  const idleWorkers: Worker[] = [];
  /** fileId → 正在处理该文件的 Worker，供 cancelUploadTask 精确取消（P1-8） */
  const taskWorkerMap = new Map<string, Worker>();

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

  const cancelUploadTask = (fileId: string): void => {
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

  const runUploadTask = (
    options: RunUploadTaskOptions
  ): Promise<UploadTaskResult> => {
    if (options.signal?.aborted) {
      return Promise.resolve({
        success: false,
        skipped: false,
        cancelled: true,
        errorMessage: "上传已取消",
      });
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
        fileRef: options.fileRef,
        networkParams: options.networkParams,
        uploadConfig: options.uploadConfig,
      };

      // 注意：File 通过结构化克隆传入 Worker（不转移），主线程注册表仍需持有该
      // 引用以支持刷新后的重选/重试；若用 transfer 列表转移，主线程引用会被置空。
      worker.postMessage(message);
    });
  };

  const dispose = () => {
    for (const worker of Array.from(workerPool)) {
      disposeUploadWorker(worker);
    }
    taskWorkerMap.clear();
  };

  return {
    runUploadTask,
    cancelUploadTask,
    dispose,
  };
};
