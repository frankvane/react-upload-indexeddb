// 内联 worker（见 useFileProcessor 注释）：避免发布后被消费方当作外部资产 404。
import DownloadWorker from "./downloader.worker.ts?worker&inline";
import MergeWorker from "./merger.worker.ts?worker&inline";

// 导出Worker创建函数
export const createDownloadWorker = () => new DownloadWorker();

export const createMergeWorker = () => new MergeWorker();
