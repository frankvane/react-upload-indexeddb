import { Alert, Button, Progress } from "antd";

import React from "react";
import { useUploadStore } from "../store/upload";

const BatchInfoDisplay: React.FC = () => {
  const { batchInfo, isUploading, cancelUpload, clearBatchInfo } =
    useUploadStore();

  if (!batchInfo) return null;

  const { current, total, completed, failed, retried } = batchInfo;
  const percent = total > 0 ? Math.floor((current / total) * 100) : 0;
  const isCompleted = current === total;

  return (
    <div style={{ marginBottom: 16 }}>
      <Alert
        type={isCompleted ? "success" : "info"}
        message={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <span>
                批量上传进度: {current}/{total} 文件
                {completed > 0 && (
                  <span style={{ color: "#52c41a", marginLeft: 8 }}>
                    成功: {completed}
                  </span>
                )}
                {failed > 0 && (
                  <span style={{ color: "#f5222d", marginLeft: 8 }}>
                    失败: {failed}
                  </span>
                )}
                {retried > 0 && (
                  <span style={{ color: "#fa8c16", marginLeft: 8 }}>
                    重试: {retried}
                  </span>
                )}
              </span>
              <Progress
                percent={percent}
                size="small"
                status={isCompleted ? "success" : "active"}
                style={{ marginTop: 8 }}
              />
            </div>
            <div>
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
        }
      />
    </div>
  );
};

export default BatchInfoDisplay;
