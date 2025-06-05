import { Alert, Card, Col, Progress, Row, Statistic } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";

import { BatchInfo } from "../types/download";
import React from "react";
import { useDownloadStore } from "../store/download";

/**
 * 下载信息显示组件
 *
 * 显示下载相关的信息，如进度、速度、剩余时间等
 */
const DownloadInfoDisplay: React.FC = () => {
  const {
    totalProgress,
    activeDownloads,
    completedDownloads,
    failedDownloads,
    batchInfo,
  } = useDownloadStore();

  // 如果没有批次信息，显示简单统计
  if (!batchInfo) {
    return (
      <div className="download-info-display">
        <Row gutter={16} style={{ marginTop: 16, marginBottom: 16 }}>
          <Col span={6}>
            <Statistic
              title="活跃下载"
              value={activeDownloads}
              prefix={<DownloadOutlined />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="已完成"
              value={completedDownloads}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: "#3f8600" }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="失败"
              value={failedDownloads}
              prefix={<WarningOutlined />}
              valueStyle={{ color: "#cf1322" }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="总进度"
              value={totalProgress}
              suffix="%"
              precision={1}
              prefix={<ClockCircleOutlined />}
            />
          </Col>
        </Row>
      </div>
    );
  }

  // 显示批次下载信息
  return (
    <div className="download-info-display">
      <BatchInfoDisplay batchInfo={batchInfo} />
    </div>
  );
};

/**
 * 批次信息显示组件
 */
interface BatchInfoDisplayProps {
  batchInfo: BatchInfo;
}

const BatchInfoDisplay: React.FC<BatchInfoDisplayProps> = ({ batchInfo }) => {
  const {
    current,
    total,
    queued,
    active,
    completed,
    failed,
    countdown,
    averageSpeed,
    totalSize,
    downloadedSize,
  } = batchInfo;

  // 格式化文件大小
  const formatSize = (bytes?: number): string => {
    if (bytes === undefined) return "未知";

    const sizes = ["B", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 B";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  // 格式化速度
  const formatSpeed = (bytesPerSecond?: number): string => {
    if (bytesPerSecond === undefined) return "未知";
    return `${formatSize(bytesPerSecond)}/s`;
  };

  // 计算剩余时间
  const calculateTimeRemaining = (): string => {
    if (!averageSpeed || !totalSize || !downloadedSize || averageSpeed <= 0) {
      return "计算中...";
    }

    const remainingBytes = totalSize - downloadedSize;
    const remainingSeconds = Math.ceil(remainingBytes / averageSpeed);

    if (remainingSeconds < 60) {
      return `${remainingSeconds} 秒`;
    } else if (remainingSeconds < 3600) {
      return `${Math.floor(remainingSeconds / 60)} 分钟 ${
        remainingSeconds % 60
      } 秒`;
    } else {
      const hours = Math.floor(remainingSeconds / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      return `${hours} 小时 ${minutes} 分钟`;
    }
  };

  // 计算完成百分比
  const completedPercentage = total > 0 ? (completed / total) * 100 : 0;

  return (
    <Card
      className="batch-info-card"
      style={{ marginTop: 16, marginBottom: 16 }}
    >
      <Alert
        message={`批量下载进度: ${current}/${total} 文件`}
        description={
          <div>
            <Progress
              percent={Math.round(completedPercentage)}
              status={failed > 0 ? "exception" : "active"}
            />
            <Row gutter={16} style={{ marginTop: 16 }}>
              <Col span={8}>
                <Statistic title="等待中" value={queued} />
              </Col>
              <Col span={8}>
                <Statistic title="下载中" value={active} />
              </Col>
              <Col span={8}>
                <Statistic
                  title="已完成"
                  value={completed}
                  valueStyle={{ color: "#3f8600" }}
                />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 16 }}>
              <Col span={8}>
                <Statistic
                  title="失败"
                  value={failed}
                  valueStyle={{ color: "#cf1322" }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="下载速度"
                  value={formatSpeed(averageSpeed)}
                  valueStyle={{ fontSize: "14px" }}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title="剩余时间"
                  value={calculateTimeRemaining()}
                  valueStyle={{ fontSize: "14px" }}
                />
              </Col>
            </Row>
            <Row gutter={16} style={{ marginTop: 16 }}>
              <Col span={12}>
                <Statistic
                  title="已下载/总大小"
                  value={`${formatSize(downloadedSize)} / ${formatSize(
                    totalSize
                  )}`}
                  valueStyle={{ fontSize: "14px" }}
                />
              </Col>
              {countdown !== undefined && countdown > 0 && (
                <Col span={12}>
                  <Statistic
                    title="自动清理倒计时"
                    value={`${countdown} 秒后清理`}
                    valueStyle={{ fontSize: "14px", color: "#1890ff" }}
                  />
                </Col>
              )}
            </Row>
          </div>
        }
        type="info"
        showIcon
      />
    </Card>
  );
};

export default DownloadInfoDisplay;
