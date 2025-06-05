import { Alert, Button, Progress, Tag } from "antd";

import React from "react";
import { useBatchUploader } from "../hooks/useBatchUploader";
import { useUploadStore } from "../store/upload";

const BatchInfoDisplay: React.FC = () => {
  const { batchInfo, isUploading, cancelUpload, clearBatchInfo } =
    useUploadStore();

  // 获取清理功能
  const { forceCleanupUI, pendingCleanupCount } = useBatchUploader();

  if (!batchInfo) return null;

  const {
    current,
    total,
    completed,
    failed,
    retried,
    queued,
    active,
    countdown,
  } = batchInfo;
  const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
  const isCompleted = current === total;

  // 获取待清理的文件数量
  const pendingCount = pendingCleanupCount();

  return (
    <div style={{ marginBottom: 16 }}>
      <Alert
        type={isCompleted ? "success" : "info"}
        message={
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <div>
                <span style={{ fontSize: "12px", color: "#666" }}>
                  <span style={{ marginRight: 16 }}>
                    活跃: <Tag color="processing">{active}</Tag>
                  </span>
                  <span style={{ marginRight: 16 }}>
                    等待: <Tag color="default">{queued}</Tag>
                  </span>
                  <span style={{ marginRight: 16 }}>
                    完成: <Tag color="success">{completed}</Tag>
                  </span>
                  {failed > 0 && (
                    <span style={{ marginRight: 16 }}>
                      失败: <Tag color="error">{failed}</Tag>
                    </span>
                  )}
                  {retried > 0 && (
                    <span style={{ marginRight: 16 }}>
                      重试: <Tag color="warning">{retried}</Tag>
                    </span>
                  )}
                  <span style={{ marginRight: 16 }}>
                    批量上传进度: {current}/{total}
                  </span>
                  {countdown !== undefined && countdown > 0 && (
                    <span style={{ marginRight: 16 }}>
                      清理倒计时: <Tag color="cyan">{countdown}秒</Tag>
                    </span>
                  )}
                </span>
              </div>
              <div>
                {pendingCount > 0 && (
                  <Button
                    size="small"
                    style={{ marginRight: 8 }}
                    onClick={() => {
                      // 使用异步方式调用forceCleanupUI
                      forceCleanupUI()
                        .then(() => {
                          console.log("清除记录完成");
                        })
                        .catch((err) => {
                          console.error("清除记录出错:", err);
                        });
                    }}
                  >
                    清除记录
                  </Button>
                )}
                {isUploading ? (
                  <Button danger size="small" onClick={cancelUpload}>
                    取消上传
                  </Button>
                ) : (
                  <Button size="small" onClick={clearBatchInfo}>
                    清除信息
                  </Button>
                )}
              </div>
            </div>
            <Progress
              percent={percent}
              size="small"
              status={isCompleted ? "success" : "active"}
            />
          </div>
        }
      />
    </div>
  );
};

export default BatchInfoDisplay;
