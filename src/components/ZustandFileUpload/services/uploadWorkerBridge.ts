import { UploadFile } from "../types/upload";
import {
  UploadWorkerRequest,
  UploadWorkerResponse,
} from "../types/workerProtocol";

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

const createUploadWorker = () =>
  new Worker(new URL("../worker/uploadWorker.ts", import.meta.url), {
    type: "module",
  });

const workerPool = new Set<Worker>();
const idleWorkers: Worker[] = [];

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
      cleanup();
      resolve(result);
    };

    const handleAbort = () => {
      shouldRecycleWorker = false;
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
      }
    };

    const message: UploadWorkerRequest = {
      type: "upload",
      fileInfo: {
        id: options.file.id,
        fileName: options.file.fileName,
        fileSize: options.file.fileSize,
        hash: options.file.hash,
        chunkSize: options.file.chunkSize,
      },
      fileBuffer: options.fileBuffer,
      networkParams: options.networkParams,
      uploadConfig: options.uploadConfig,
    };

    worker.postMessage(message, [options.fileBuffer]);
  });
};
