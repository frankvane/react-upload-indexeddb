import { Button, Progress, Space, Table, Tag, Tooltip } from "antd";
import {
  DeleteOutlined,
  FileOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { DownloadStatus, DownloadTask } from "../types/download";

import React from "react";
import useBatchDownloader from "../hooks/useBatchDownloader";
import { useDownloadStore } from "../store/download";

/**
 * 下载表格组件
 *
 * 显示下载任务列表，包括文件名、大小、进度、状态等信息
 */
const DownloadTable: React.FC = () => {
  const { downloadTasks, isNetworkOffline } = useDownloadStore();
  const { cancelDownload, retryDownload } = useBatchDownloader();
  const { pauseDownload, resumeDownload } = useDownloadStore();

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  // 格式化下载速度
  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return "0 B/s";
    return `${formatFileSize(bytesPerSecond)}/s`;
  };

  // 获取状态标签
  const getStatusTag = (status: DownloadStatus): JSX.Element => {
    switch (status) {
      case DownloadStatus.QUEUED:
        return <Tag color="default">排队中</Tag>;
      case DownloadStatus.PREPARING:
        return <Tag color="processing">准备中</Tag>;
      case DownloadStatus.DOWNLOADING:
        return <Tag color="blue">下载中</Tag>;
      case DownloadStatus.PAUSED:
        return <Tag color="warning">已暂停</Tag>;
      case DownloadStatus.COMPLETED:
        return <Tag color="success">已完成</Tag>;
      case DownloadStatus.FAILED:
        return <Tag color="error">失败</Tag>;
      case DownloadStatus.CANCELED:
        return <Tag color="default">已取消</Tag>;
      case DownloadStatus.NETWORK_ERROR:
        return <Tag color="error">网络错误</Tag>;
      case DownloadStatus.COMPLETED_CHUNKS:
        return <Tag color="processing">分片完成</Tag>;
      case DownloadStatus.MERGING:
        return <Tag color="processing">合并中</Tag>;
      case DownloadStatus.MERGE_ERROR:
        return <Tag color="error">合并错误</Tag>;
      default:
        return <Tag color="default">未知</Tag>;
    }
  };

  // 表格列定义
  const columns = [
    {
      title: "文件名",
      dataIndex: "fileName",
      key: "fileName",
      render: (text: string) => (
        <Space>
          <FileOutlined />
          <Tooltip title={text}>
            <span className="file-name">
              {text.length > 30 ? `${text.substring(0, 30)}...` : text}
            </span>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: "大小",
      dataIndex: "fileSize",
      key: "fileSize",
      render: (size: number) => formatFileSize(size),
      width: 120,
    },
    {
      title: "进度",
      dataIndex: "progress",
      key: "progress",
      render: (progress: number, record: DownloadTask) => (
        <Progress
          percent={Math.round(progress)}
          size="small"
          status={
            record.status === DownloadStatus.FAILED ||
            record.status === DownloadStatus.MERGE_ERROR
              ? "exception"
              : record.status === DownloadStatus.COMPLETED
              ? "success"
              : "active"
          }
        />
      ),
      width: 180,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: DownloadStatus) => getStatusTag(status),
      width: 100,
    },
    {
      title: "速度",
      dataIndex: "speed",
      key: "speed",
      render: (speed: number, record: DownloadTask) =>
        record.status === DownloadStatus.DOWNLOADING ? formatSpeed(speed) : "-",
      width: 120,
    },
    {
      title: "操作",
      key: "action",
      render: (text: string, record: DownloadTask) => (
        <Space size="small">
          {record.status === DownloadStatus.DOWNLOADING && (
            <Button
              icon={<PauseCircleOutlined />}
              size="small"
              onClick={() => pauseDownload(record.id)}
              title="暂停"
            />
          )}
          {record.status === DownloadStatus.PAUSED && (
            <Button
              icon={<PlayCircleOutlined />}
              size="small"
              onClick={() => resumeDownload(record.id)}
              disabled={isNetworkOffline}
              title={isNetworkOffline ? "网络已断开，无法继续下载" : "继续下载"}
            />
          )}
          {(record.status === DownloadStatus.FAILED ||
            record.status === DownloadStatus.MERGE_ERROR) && (
            <Button
              icon={<ReloadOutlined />}
              size="small"
              onClick={() => retryDownload(record.id)}
              disabled={isNetworkOffline}
              title={isNetworkOffline ? "网络已断开，无法重试下载" : "重试下载"}
            />
          )}
          {record.status !== DownloadStatus.COMPLETED && (
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
              onClick={() => cancelDownload(record.id)}
              title="取消下载"
            />
          )}
        </Space>
      ),
      width: 120,
    },
  ];

  return (
    <div className="download-table">
      <Table
        columns={columns}
        dataSource={downloadTasks}
        rowKey="id"
        pagination={{ pageSize: 10 }}
        size="middle"
        scroll={{ y: 400 }}
      />
    </div>
  );
};

/**
 * 速率显示组件
 */
export const RateDisplay: React.FC<{ speed: number }> = ({ speed }) => {
  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  return <div className="rate-display">{formatFileSize(speed)}/s</div>;
};

export default DownloadTable;
