import { Button, Progress, Tag, Typography } from "antd";
import { CHUNK_SIZE, DownloadFile, DownloadStatus } from "../types";
import { Card, Empty, Space, Spin, Table } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import React, { useCallback, useMemo, useState } from "react";

import { formatFileSize } from "../utils";
import { useDownloadFiles } from "../hooks/useDownloadFiles";
import { useFileDownloader } from "../hooks/useFileDownloader";

const { Text } = Typography;

/**
 * 文件列表组件
 */
export const FileList: React.FC = () => {
  const { files, fetchingFiles, fetchFileList } = useDownloadFiles();

  const {
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteFile,
    exportFile,
    processingFiles,
  } = useFileDownloader();

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleBatchDownload = useCallback(() => {
    const downloadableFiles = files.filter(
      (file) =>
        file.status === DownloadStatus.IDLE ||
        file.status === DownloadStatus.ERROR ||
        file.status === DownloadStatus.PAUSED
    );

    downloadableFiles.forEach((file) => {
      startDownload(file);
    });

    setSelectedRowKeys([]);
  }, [files, startDownload]);

  const handleBatchPause = useCallback(() => {
    const downloadingFiles = files.filter(
      (file) => file.status === DownloadStatus.DOWNLOADING
    );

    downloadingFiles.forEach((file) => {
      pauseDownload(file.id);
    });

    setSelectedRowKeys([]);
  }, [files, pauseDownload]);

  const handleBatchResume = useCallback(() => {
    const pausedFiles = files.filter(
      (file) => file.status === DownloadStatus.PAUSED
    );

    pausedFiles.forEach((file) => {
      resumeDownload(file.id);
    });

    setSelectedRowKeys([]);
  }, [files, resumeDownload]);

  const handleRefreshFiles = useCallback(() => {
    if (isRefreshing || fetchingFiles) return;

    setIsRefreshing(true);
    fetchFileList();

    setTimeout(() => {
      setIsRefreshing(false);
    }, 1000);
  }, [fetchFileList, isRefreshing, fetchingFiles]);

  const rowSelection = useMemo(
    () => ({
      selectedRowKeys,
      onChange: (selectedKeys: React.Key[]) => {
        setSelectedRowKeys(selectedKeys);
      },
      getCheckboxProps: (record: DownloadFile) => ({
        disabled: processingFiles.includes(record.id),
      }),
    }),
    [selectedRowKeys, processingFiles]
  );

  const columns = useMemo(
    () => [
      {
        title: "文件名",
        dataIndex: "fileName",
        key: "fileName",
        ellipsis: true,
        width: "25%",
        render: (text: string) => (
          <Text ellipsis title={text}>
            {text}
          </Text>
        ),
      },
      {
        title: "大小",
        dataIndex: "fileSize",
        key: "fileSize",
        width: "12%",
        render: (size: number) => formatFileSize(size),
      },
      {
        title: "分片",
        key: "chunks",
        width: "12%",
        render: (_: unknown, record: DownloadFile) => {
          const chunkSize = record.chunkSize || CHUNK_SIZE;
          const formattedChunkSize = formatFileSize(chunkSize);

          const lastChunkSize = record.fileSize % chunkSize || chunkSize;
          const isLastChunkDifferent =
            lastChunkSize !== chunkSize && record.totalChunks > 1;

          return (
            <div>
              <div>
                {record.downloadedChunks || 0}/{record.totalChunks || 0}
              </div>
              <div style={{ fontSize: "12px", color: "#999" }}>
                {formattedChunkSize}/片
                {isLastChunkDifferent && (
                  <span
                    title={`最后一个分片大小: ${formatFileSize(lastChunkSize)}`}
                  >
                    *
                  </span>
                )}
              </div>
            </div>
          );
        },
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: "12%",
        render: (
          status: (typeof DownloadStatus)[keyof typeof DownloadStatus]
        ) => {
          let tagColor = "";
          let statusText = "";

          switch (status) {
            case DownloadStatus.DOWNLOADING:
              tagColor = "processing";
              statusText = "下载中";
              break;
            case DownloadStatus.PAUSED:
              tagColor = "warning";
              statusText = "已暂停";
              break;
            case DownloadStatus.COMPLETED:
              tagColor = "success";
              statusText = "已完成";
              break;
            case DownloadStatus.PREPARING:
              tagColor = "blue";
              statusText = "准备中";
              break;
            case DownloadStatus.ERROR:
              tagColor = "error";
              statusText = "错误";
              break;
            default:
              statusText = "等待下载";
          }

          return (
            <Space>
              <Tag color={tagColor}>{statusText}</Tag>
            </Space>
          );
        },
      },
      {
        title: "进度",
        dataIndex: "progress",
        key: "progress",
        width: "18%",
        render: (progress: number, record: DownloadFile) => {
          if (
            record.status === DownloadStatus.DOWNLOADING ||
            record.status === DownloadStatus.PAUSED
          ) {
            return (
              <Progress
                percent={progress || 0}
                size="small"
                status={
                  record.status === DownloadStatus.PAUSED
                    ? "exception"
                    : "active"
                }
              />
            );
          } else if (record.status === DownloadStatus.ERROR) {
            return (
              <Text type="danger" ellipsis title={record.error}>
                {record.error}
              </Text>
            );
          }
          return null;
        },
      },
      {
        title: "操作",
        key: "action",
        width: "21%",
        render: (_: any, record: DownloadFile) => {
          const isDownloading = record.status === DownloadStatus.DOWNLOADING;
          const isPaused = record.status === DownloadStatus.PAUSED;
          const isCompleted = record.status === DownloadStatus.COMPLETED;
          const isPreparing = record.status === DownloadStatus.PREPARING;
          const isIdle = record.status === DownloadStatus.IDLE;

          return (
            <Space>
              {isDownloading && (
                <Button
                  size="small"
                  icon={<PauseCircleOutlined />}
                  onClick={() => pauseDownload(record.id)}
                >
                  暂停
                </Button>
              )}
              {isPaused && (
                <Button
                  size="small"
                  icon={<PlayCircleOutlined />}
                  onClick={() => resumeDownload(record.id)}
                >
                  继续
                </Button>
              )}
              {isCompleted && (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  onClick={() => exportFile(record)}
                  icon={<ExportOutlined />}
                  style={{ color: "#52c41a", borderColor: "#52c41a" }}
                >
                  导出
                </Button>
              )}
              {(isIdle || (!isDownloading && !isPaused && !isCompleted)) && (
                <Button
                  size="small"
                  type="primary"
                  icon={<DownloadOutlined />}
                  loading={isPreparing}
                  disabled={isDownloading || isCompleted}
                  onClick={() => startDownload(record)}
                >
                  下载
                </Button>
              )}

              {!isIdle && !isCompleted && (
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => cancelDownload(record.id)}
                >
                  取消
                </Button>
              )}
              {(isIdle || isCompleted) && (
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => deleteFile(record.id)}
                >
                  删除
                </Button>
              )}
            </Space>
          );
        },
      },
    ],
    [
      processingFiles,
      startDownload,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      deleteFile,
      exportFile,
    ]
  );

  const fileStatus = useMemo(() => {
    const hasDownloadingFiles = files.some(
      (file) => file.status === DownloadStatus.DOWNLOADING
    );

    const hasPausedFiles = files.some(
      (file) => file.status === DownloadStatus.PAUSED
    );

    const hasDownloadableFiles = files.some(
      (file) =>
        file.status === DownloadStatus.IDLE ||
        file.status === DownloadStatus.ERROR ||
        file.status === DownloadStatus.PAUSED
    );

    return {
      hasDownloadableFiles,
      hasDownloadingFiles,
      hasPausedFiles,
      selectionCount: selectedRowKeys.length,
    };
  }, [selectedRowKeys, files]);

  return (
    <Card
      title={
        <span>
          文件列表
          {fetchingFiles && <Spin size="small" style={{ marginLeft: 8 }} />}
        </span>
      }
      extra={
        <Space>
          {fileStatus.selectionCount > 0 && (
            <Text type="secondary">
              已选择 {fileStatus.selectionCount} 个文件
            </Text>
          )}
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleBatchDownload}
            disabled={!fileStatus.hasDownloadableFiles}
          >
            下载全部
          </Button>
          <Button
            icon={<PauseCircleOutlined />}
            onClick={handleBatchPause}
            disabled={!fileStatus.hasDownloadingFiles}
          >
            批量暂停
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            onClick={handleBatchResume}
            disabled={!fileStatus.hasPausedFiles}
          >
            批量继续
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefreshFiles}
            title="刷新文件列表"
            loading={fetchingFiles || isRefreshing}
            disabled={fetchingFiles || isRefreshing}
          >
            刷新
          </Button>
        </Space>
      }
    >
      <Table
        rowSelection={rowSelection}
        columns={columns}
        dataSource={files}
        rowKey="id"
        pagination={false}
        loading={fetchingFiles}
        locale={{ emptyText: <Empty description="暂无文件" /> }}
        size="middle"
        scroll={{ x: 800 }}
      />
    </Card>
  );
};
