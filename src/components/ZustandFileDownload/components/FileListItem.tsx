import { Button, List, Progress, Space, Tag, Tooltip, Typography } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  FileOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { DownloadFile, DownloadStatus } from "../types";

import React from "react";
import { formatFileSize } from "../utils";

const { Text } = Typography;

interface FileListItemProps {
  file: DownloadFile;
  isProcessing: boolean;
  onStartDownload: (file: DownloadFile) => void;
  onPauseDownload: (fileId: string) => void;
  onResumeDownload: (fileId: string) => void;
  onCancelDownload: (fileId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onExportFile: (file: DownloadFile) => void;
  onResetProcessingState?: (fileId: string) => void;
}

/**
 * 文件列表项组件
 */
export const FileListItem: React.FC<FileListItemProps> = ({
  file,
  isProcessing,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  onDeleteFile,
  onExportFile,
  onResetProcessingState,
}) => {
  // 使用变量存储状态，避免类型错误
  const isDownloading = file.status === DownloadStatus.DOWNLOADING;
  const isPaused = file.status === DownloadStatus.PAUSED;
  const isCompleted = file.status === DownloadStatus.COMPLETED;
  const isPreparing = file.status === DownloadStatus.PREPARING;
  const isIdle = file.status === DownloadStatus.IDLE;
  const isError = file.status === DownloadStatus.ERROR;

  // 渲染状态标签
  const renderStatusTag = () => {
    if (isDownloading) return <Tag color="processing">下载中</Tag>;
    if (isPaused) return <Tag color="warning">已暂停</Tag>;
    if (isCompleted) return <Tag color="success">已完成</Tag>;
    if (isPreparing) return <Tag color="blue">准备中</Tag>;
    if (isError) return <Tag color="error">错误</Tag>;
    return <Tag>等待下载</Tag>;
  };

  // 渲染下载按钮
  const renderDownloadButton = () => {
    if (isDownloading) {
      return (
        <Button
          icon={<PauseCircleOutlined />}
          onClick={() => onPauseDownload(file.id)}
        >
          暂停
        </Button>
      );
    } else if (isPaused) {
      return (
        <Button
          icon={<PlayCircleOutlined />}
          onClick={() => onResumeDownload(file.id)}
        >
          继续
        </Button>
      );
    } else if (isCompleted) {
      return (
        <Button
          type="primary"
          onClick={() => onExportFile(file)}
          icon={<DownloadOutlined />}
        >
          导出
        </Button>
      );
    } else {
      return (
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          loading={isPreparing}
          disabled={isDownloading || isCompleted}
          onClick={() => onStartDownload(file)}
        >
          {isPreparing ? "准备中" : "下载"}
        </Button>
      );
    }
  };

  // 渲染删除/取消按钮
  const renderDeleteButton = () => {
    if (!isIdle && !isCompleted) {
      return (
        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={() => onCancelDownload(file.id)}
        >
          取消
        </Button>
      );
    } else if (isCompleted) {
      return (
        <Button
          danger
          icon={<DeleteOutlined />}
          onClick={() => onDeleteFile(file.id)}
        >
          删除
        </Button>
      );
    }
    return null;
  };

  // 渲染重置按钮（仅在处理中状态且提供了重置函数时显示）
  const renderResetButton = () => {
    if (isProcessing && onResetProcessingState) {
      return (
        <Tooltip title="重置处理状态（如果下载卡住）">
          <Button
            type="dashed"
            icon={<ReloadOutlined />}
            onClick={() => onResetProcessingState(file.id)}
            size="small"
          >
            重置
          </Button>
        </Tooltip>
      );
    }
    return null;
  };

  return (
    <List.Item
      key={file.id}
      actions={[
        renderDownloadButton(),
        renderDeleteButton(),
        renderResetButton(),
      ].filter(Boolean)}
    >
      <List.Item.Meta
        avatar={<FileOutlined />}
        title={<Text>{file.fileName}</Text>}
        description={
          <Space direction="vertical" style={{ width: "100%" }}>
            <Space>
              <Text type="secondary">{formatFileSize(file.fileSize)}</Text>
              {renderStatusTag()}
              {isProcessing && <Text type="secondary">处理中...</Text>}
            </Space>
            {(isDownloading || isPaused) && (
              <Progress
                percent={file.progress || 0}
                size="small"
                status={isPaused ? "exception" : "active"}
              />
            )}
            {isError && <Text type="danger">{file.error}</Text>}
          </Space>
        }
      />
    </List.Item>
  );
};
