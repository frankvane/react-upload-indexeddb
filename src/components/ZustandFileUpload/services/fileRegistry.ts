/**
 * 主线程 File 引用注册表（T3.1 流式分片）。
 *
 * 背景：T3.1 起 IndexedDB 只持久化上传元数据，文件字节不再整文件驻留
 * （原 UploadFile.buffer 已移除）。上传时由 uploadWorker 按分片
 * `fileRef.slice(start, end)` 惰性读取，内存占用与文件大小解耦。
 *
 * 生命周期：
 * - register：文件预处理完成（useFileProcessor）时登记；
 * - release ：上传成功/失败终态、删除、清理时释放（避免 File 句柄长期
 *             驻留导致底层数据无法 GC）；
 * - 页面刷新后注册表清空 → 记录标记 awaitingReselect，用户重新选择
 *   同一文件时以相同队列 id 再次登记。
 *
 * 注意：本表为模块级单例。T3.2 单例治理后会改为按组件实例持有，
 * 当前多实例场景下各实例共享同一注册表（按文件 id 隔离，互不影响）。
 */
const fileRegistry = new Map<string, File>();

/** 登记文件引用（同 id 重复登记以最新为准） */
export const registerFileRef = (id: string, file: File): void => {
  fileRegistry.set(id, file);
};

/** 取文件引用；不存在返回 undefined（典型场景：页面刷新后未重新选择） */
export const getFileRef = (id: string): File | undefined => fileRegistry.get(id);

/** 释放单个文件引用 */
export const releaseFileRef = (id: string): void => {
  fileRegistry.delete(id);
};

/** 清空全部引用（仅测试/调试用；业务释放走 releaseFileRef） */
export const releaseAllFileRefs = (): void => {
  fileRegistry.clear();
};

/** 当前登记数量（测试与调试用） */
export const fileRefCount = (): number => fileRegistry.size;
