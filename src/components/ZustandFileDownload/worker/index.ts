// 导出Worker创建函数
export const createDownloadWorker = () => {
  return new Worker(new URL("./downloader.worker.ts", import.meta.url), {
    type: "module", // 使用module类型
  });
};

export const createMergeWorker = () => {
  return new Worker(new URL("./merger.worker.ts", import.meta.url), {
    type: "module", // 使用module类型
  });
};
