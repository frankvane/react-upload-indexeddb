import { Button, Progress, Tag, Tooltip, Typography } from "antd";
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

  // 下载选中的文件
  const handleDownloadSelected = useCallback(() => {
    if (selectedRowKeys.length === 0) return;

    const selectedFiles = files.filter(
      (file) =>
        selectedRowKeys.includes(file.id) &&
        (file.status === DownloadStatus.IDLE ||
          file.status === DownloadStatus.ERROR ||
          file.status === DownloadStatus.PAUSED)
    );

    selectedFiles.forEach((file) => {
      startDownload(file);
    });

    setSelectedRowKeys([]);
  }, [files, selectedRowKeys, startDownload]);

  // 删除选中的文件
  const handleDeleteSelected = useCallback(() => {
    if (selectedRowKeys.length === 0) return;

    const selectedFiles = files.filter(
      (file) =>
        selectedRowKeys.includes(file.id) &&
        (file.status === DownloadStatus.IDLE ||
          file.status === DownloadStatus.COMPLETED)
    );

    selectedFiles.forEach((file) => {
      deleteFile(file.id);
    });

    setSelectedRowKeys([]);
  }, [files, selectedRowKeys, deleteFile]);

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
                <Tooltip title="暂停">
                  <Button
                    size="small"
                    type="text"
                    icon={<PauseCircleOutlined />}
                    onClick={() => pauseDownload(record.id)}
                  />
                </Tooltip>
              )}
              {isPaused && (
                <Tooltip title="继续">
                  <Button
                    size="small"
                    type="text"
                    icon={<PlayCircleOutlined />}
                    onClick={() => resumeDownload(record.id)}
                  />
                </Tooltip>
              )}
              {isCompleted && (
                <Tooltip title="导出">
                  <Button
                    size="small"
                    type="text"
                    onClick={() => exportFile(record)}
                    icon={<ExportOutlined style={{ color: "#52c41a" }} />}
                  />
                </Tooltip>
              )}
              {(isIdle || (!isDownloading && !isPaused && !isCompleted)) && (
                <Tooltip title="下载">
                  <Button
                    size="small"
                    type="text"
                    icon={<DownloadOutlined style={{ color: "#1890ff" }} />}
                    loading={isPreparing}
                    disabled={isDownloading || isCompleted}
                    onClick={() => startDownload(record)}
                  />
                </Tooltip>
              )}

              {!isIdle && !isCompleted && (
                <Tooltip title="取消">
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined style={{ color: "#ff4d4f" }} />}
                    onClick={() => cancelDownload(record.id)}
                  />
                </Tooltip>
              )}
              {(isIdle || isCompleted) && (
                <Tooltip title="删除">
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined style={{ color: "#ff4d4f" }} />}
                    onClick={() => deleteFile(record.id)}
                  />
                </Tooltip>
              )}
            </Space>
          );
        },
      },
    ],
    [
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

    // 检查选中的文件中是否有可下载的文件
    const hasSelectedDownloadable =
      selectedRowKeys.length > 0 &&
      files.some(
        (file) =>
          selectedRowKeys.includes(file.id) &&
          (file.status === DownloadStatus.IDLE ||
            file.status === DownloadStatus.ERROR ||
            file.status === DownloadStatus.PAUSED)
      );

    // 检查选中的文件中是否有可删除的文件
    const hasSelectedDeletable =
      selectedRowKeys.length > 0 &&
      files.some(
        (file) =>
          selectedRowKeys.includes(file.id) &&
          (file.status === DownloadStatus.IDLE ||
            file.status === DownloadStatus.COMPLETED)
      );

    return {
      hasDownloadableFiles,
      hasDownloadingFiles,
      hasPausedFiles,
      selectionCount: selectedRowKeys.length,
      hasSelectedDownloadable,
      hasSelectedDeletable,
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
          <Tooltip title="下载选中">
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleDownloadSelected}
              disabled={!fileStatus.hasSelectedDownloadable}
            />
          </Tooltip>
          <Tooltip title="删除选中">
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleDeleteSelected}
              disabled={!fileStatus.hasSelectedDeletable}
            />
          </Tooltip>
          <Tooltip title="下载全部">
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleBatchDownload}
              disabled={!fileStatus.hasDownloadableFiles}
            />
          </Tooltip>
          <Tooltip title="批量暂停">
            <Button
              icon={<PauseCircleOutlined />}
              onClick={handleBatchPause}
              disabled={!fileStatus.hasDownloadingFiles}
            />
          </Tooltip>
          <Tooltip title="批量继续">
            <Button
              icon={<PlayCircleOutlined />}
              onClick={handleBatchResume}
              disabled={!fileStatus.hasPausedFiles}
            />
          </Tooltip>
          <Tooltip title="刷新文件列表">
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefreshFiles}
              loading={fetchingFiles || isRefreshing}
              disabled={fetchingFiles || isRefreshing}
            />
          </Tooltip>
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
