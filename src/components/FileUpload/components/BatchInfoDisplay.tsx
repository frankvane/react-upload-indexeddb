import { Button, Tag } from "antd";

import React from "react";

interface BatchInfo {
  active: number;
  queued: number;
  completed: number;
  failed: number;
  retried: number;
  current: number;
  total: number;
}

interface BatchInfoDisplayProps {
  batchInfo: BatchInfo | null;
  isUploading: boolean;
  cancelUpload: () => void;
  clearBatchInfo: () => void;
}

const BatchInfoDisplay: React.FC<BatchInfoDisplayProps> = ({
  batchInfo,
  isUploading,
  cancelUpload,
  clearBatchInfo,
}) => {
  if (!batchInfo) return null;

  return (
    <div style={{ marginBottom: 16, color: "#722ED1" }}>
      <div style={{ fontSize: "12px", color: "#666" }}>
        <span style={{ marginRight: 16 }}>
          活跃: <Tag color="processing">{batchInfo.active}</Tag>
        </span>
        <span style={{ marginRight: 16 }}>
          等待: <Tag color="default">{batchInfo.queued}</Tag>
        </span>
        <span style={{ marginRight: 16 }}>
          完成: <Tag color="success">{batchInfo.completed}</Tag>
        </span>
        {batchInfo.failed > 0 && (
          <span style={{ marginRight: 16 }}>
            失败:
            <Tag color="error">{batchInfo.failed}</Tag>
          </span>
        )}
        {batchInfo.retried > 0 && (
          <span style={{ marginRight: 16 }}>
            重试:
            <Tag color="warning">{batchInfo.retried}</Tag>
          </span>
        )}
        <span style={{ marginRight: 16 }}>
          批量上传进度：{batchInfo.current}/{batchInfo.total}
        </span>
        {isUploading && (
          <Button
            size="small"
            danger
            style={{ marginLeft: 16 }}
            onClick={cancelUpload}
          >
            取消上传
          </Button>
        )}
        {!isUploading && batchInfo.current === batchInfo.total && (
          <Button
            size="small"
            style={{ marginLeft: 16 }}
            onClick={clearBatchInfo}
          >
            清除记录
          </Button>
        )}
      </div>
    </div>
  );
};

export default BatchInfoDisplay;
