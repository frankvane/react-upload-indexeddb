import { Alert, Progress, Tag } from "antd";
import React, { useMemo } from "react";

import { DownloadStatus } from "../types";
import { useDownloadStore } from "../store";

export const BatchInfoDisplay: React.FC = () => {
  const { files } = useDownloadStore();

  // 使用useMemo计算统计数据
  const stats = useMemo(() => {
    // 计算各种状态的文件数量
    const active = files.filter(
      (file) =>
        file.status === DownloadStatus.DOWNLOADING ||
        file.status === DownloadStatus.PREPARING
    ).length;

    const queued = files.filter(
      (file) =>
        file.status === DownloadStatus.IDLE ||
        file.status === DownloadStatus.PAUSED
    ).length;

    const completed = files.filter(
      (file) => file.status === DownloadStatus.COMPLETED
    ).length;

    const failed = files.filter(
      (file) => file.status === DownloadStatus.ERROR
    ).length;

    // 已处理的文件数量
    const current = completed + failed;

    // 总文件数量（不包括已完成的文件）
    const total = files.length;

    // 计算进度百分比
    const percent = total > 0 ? Math.floor((current / total) * 100) : 0;

    // 判断是否已完成
    const isCompleted =
      active === 0 && queued === 0 && total > 0 && current > 0;

    // 验证批次信息的一致性
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

  // 如果没有文件，不显示组件
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
                    活跃: <Tag color="processing">{stats.active}</Tag>
                  </span>
                  <span style={{ marginRight: 16 }}>
                    等待: <Tag color="default">{stats.queued}</Tag>
                  </span>
                  <span style={{ marginRight: 16 }}>
                    完成: <Tag color="success">{stats.completed}</Tag>
                  </span>
                  {stats.failed > 0 && (
                    <span style={{ marginRight: 16 }}>
                      失败: <Tag color="error">{stats.failed}</Tag>
                    </span>
                  )}
                  <span style={{ marginRight: 16 }}>
                    批量下载进度: {stats.validatedCurrent}/
                    {stats.validatedTotal}
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
