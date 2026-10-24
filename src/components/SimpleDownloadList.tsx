import React from "react";
import ZustandFileDownload from "./ZustandFileDownload";
import type { ZustandFileDownloadProps } from "./ZustandFileDownload/types/download";

export type SimpleDownloadListProps = ZustandFileDownloadProps;

/**
 * 简化下载组件。
 *
 * 在 {@link ZustandFileDownload} 基础上默认关闭"存储统计"、"网络状态"与
 * "批次汇总条"（活动中/排队中/已完成/批次进度）等较重的展示 UI，仅保留：
 * 文件列表 + 单文件进度 + 下载 / 暂停 / 继续 / 导出 / 删除 等核心操作。
 * 底层仍是真实的分片续传引擎（Bearer / 同域 Cookie 鉴权、断点续传、
 * 秒传能力全部保留），只是提供一套更轻的默认外观。
 *
 * 如需完整功能（含存储统计、网络状态、批次汇总条），直接使用
 * `<ZustandFileDownload />`，或在 SimpleDownloadList 上把对应属性设回 true。
 */
const SimpleDownloadList: React.FC<SimpleDownloadListProps> = (props) => {
  return (
    <ZustandFileDownload
      {...props}
      showStorageStats={props.showStorageStats ?? false}
      showNetworkStatus={props.showNetworkStatus ?? false}
      showBatchInfo={props.showBatchInfo ?? false}
      showProgress={props.showProgress ?? true}
      autoStart={props.autoStart ?? false}
    />
  );
};

export default SimpleDownloadList;
