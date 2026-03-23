const ctx: Worker = self as unknown as Worker;
type WorkerEnvelope = { type: string; payload: unknown };

ctx.addEventListener("message", async (event: MessageEvent<WorkerEnvelope>) => {
  const { type, payload } = event.data;

  if (type === "MERGE_FILE") {
    await mergeFileChunks(
      payload as {
        fileId: string;
        totalChunks: number;
        mimeType: string;
        chunks: Blob[];
      }
    );
  }
});

async function mergeFileChunks(payload: {
  fileId: string;
  totalChunks: number;
  mimeType: string;
  chunks: Blob[];
}) {
  const { fileId, totalChunks, mimeType, chunks } = payload;

  try {
    if (chunks.length !== totalChunks) {
      throw new Error(
        `Chunk count mismatch: expected ${totalChunks}, actual ${chunks.length}`
      );
    }

    const mergedBlob = new Blob(chunks, { type: mimeType });

    ctx.postMessage({
      type: "MERGE_COMPLETE",
      payload: {
        fileId,
        blob: mergedBlob,
        size: mergedBlob.size,
      },
    });
  } catch (err) {
    const error = err as Error;
    console.error("Failed to merge file:", error);

    ctx.postMessage({
      type: "ERROR",
      payload: {
        fileId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

export {};
