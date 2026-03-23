interface ProgressUpdatePayload {
  fileId: string;
  progress: number;
  downloadedChunks: number;
}

interface LastProgressRecord {
  time: number;
  progress: number;
}

const PROGRESS_UPDATE_INTERVAL = 300;
const PROGRESS_CHANGE_THRESHOLD = 5;

export const shouldEmitProgressUpdate = (
  cache: Record<string, LastProgressRecord>,
  payload: ProgressUpdatePayload
) => {
  const now = Date.now();
  const last = cache[payload.fileId] ?? { time: 0, progress: -1 };

  const shouldUpdate =
    last.progress === -1 ||
    payload.progress === 0 ||
    payload.progress === 100 ||
    Math.abs(payload.progress - last.progress) >= PROGRESS_CHANGE_THRESHOLD ||
    now - last.time >= PROGRESS_UPDATE_INTERVAL;

  if (shouldUpdate) {
    cache[payload.fileId] = { time: now, progress: payload.progress };
  }

  return shouldUpdate;
};

export const addProcessingFile = (
  prev: Set<string>,
  fileId: string
): Set<string> => {
  const next = new Set(prev);
  next.add(fileId);
  return next;
};

export const removeProcessingFile = (
  prev: Set<string>,
  fileId: string
): Set<string> => {
  const next = new Set(prev);
  next.delete(fileId);
  return next;
};
