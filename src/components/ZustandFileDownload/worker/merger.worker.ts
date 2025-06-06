// 定义Worker上下文类型
const ctx: Worker = self as any;

// 接收消息
ctx.addEventListener("message", async (event) => {
  const { type, payload } = event.data;

  if (type === "MERGE_FILE") {
    await mergeFileChunks(payload);
  } else if (type === "CANCEL") {
    // 取消操作
  }
});

// 合并文件分片
async function mergeFileChunks(payload: {
  fileId: string;
  totalChunks: number;
  mimeType: string;
  chunks: Blob[];
}) {
  const { fileId, totalChunks, mimeType, chunks } = payload;

  try {
    // 检查是否有足够的分片
    if (chunks.length !== totalChunks) {
      throw new Error(
        `分片数量不匹配: 预期 ${totalChunks}, 实际 ${chunks.length}`
      );
    }

    // 合并所有分片
    const mergedBlob = new Blob(chunks, { type: mimeType });

    // 发送合并完成消息
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
    console.error("合并文件失败:", error);

    ctx.postMessage({
      type: "ERROR",
      payload: {
        fileId,
        error: error instanceof Error ? error.message : "未知错误",
      },
    });
  }
}

// 导出空对象，使TypeScript将此文件视为模块
export {};
