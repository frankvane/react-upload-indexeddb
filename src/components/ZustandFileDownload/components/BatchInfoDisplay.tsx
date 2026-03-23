import { Alert, Progress, Tag } from "antd";
import React, { useMemo } from "react";

import { DownloadStatus } from "../types";
import { useDownloadStore } from "../store";
import { useShallow } from "zustand/react/shallow";

export const BatchInfoDisplay: React.FC = () => {
  const { files } = useDownloadStore(
    useShallow((state) => ({
      files: state.files,
    }))
  );

  const stats = useMemo(() => {
    let active = 0;
    let queued = 0;
    let completed = 0;
    let failed = 0;

    for (const file of files) {
      switch (file.status) {
        case DownloadStatus.DOWNLOADING:
        case DownloadStatus.PREPARING:
          active += 1;
          break;
        case DownloadStatus.IDLE:
        case DownloadStatus.PAUSED:
          queued += 1;
          break;
        case DownloadStatus.COMPLETED:
          completed += 1;
          break;
        case DownloadStatus.ERROR:
          failed += 1;
          break;
        default:
          break;
      }
    }

    const current = completed + failed;
    const total = files.length;
    const percent = total > 0 ? Math.floor((current / total) * 100) : 0;

    const isCompleted = active === 0 && queued === 0 && total > 0 && current > 0;
    const validatedCurrent = Math.min(current, total);
    const validatedTotal = Math.max(total, 1);

    return {
      active,
      queued,
      completed,
      failed,
      percent,
      isCompleted,
      validatedCurrent,
      validatedTotal,
    };
  }, [files]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <Alert
        type={stats.isCompleted ? "success" : "info"}
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
                    活动中: <Tag color="processing">{stats.active}</Tag>
                  </span>
                  <span style={{ marginRight: 16 }}>
                    排队中: <Tag color="default">{stats.queued}</Tag>
                  </span>
                  <span style={{ marginRight: 16 }}>
                    已完成: <Tag color="success">{stats.completed}</Tag>
                  </span>
                  {stats.failed > 0 && (
                    <span style={{ marginRight: 16 }}>
                      失败: <Tag color="error">{stats.failed}</Tag>
                    </span>
                  )}
                  <span style={{ marginRight: 16 }}>
                    批次进度: {stats.validatedCurrent}/{stats.validatedTotal}
                  </span>
                </span>
              </div>
            </div>
            <Progress
              percent={stats.percent}
              size="small"
              status={stats.isCompleted ? "success" : "active"}
            />
          </div>
        }
      />
    </div>
  );
};
