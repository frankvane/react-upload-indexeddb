export interface UploadWorkerRequest {
  type: "upload";
  fileInfo: {
    id: string;
    fileName: string;
    fileSize: number;
    hash?: string;
    chunkSize?: number;
  };
  fileBuffer: ArrayBuffer;
  networkParams?: {
    networkType?: string;
    fileConcurrency?: number;
    chunkConcurrency?: number;
    chunkSize?: number;
    maxRetries?: number;
    timeout?: number;
    retryInterval?: number;
  };
  uploadConfig: {
    baseURL: string;
    uploadApi: string;
    checkApi: string;
  };
}

export type UploadWorkerResponse =
  | {
      type: "debug";
      message: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "progress";
      progress: number;
      chunkIndex?: number;
    }
  | {
      type: "done";
      skipped?: boolean;
    }
  | {
      type: "error";
      message?: string;
      failedChunks?: number[];
    }
  | {
      type: "retry";
      error?: string;
      attemptNumber?: number;
      retriesLeft?: number;
      message?: string;
    };

