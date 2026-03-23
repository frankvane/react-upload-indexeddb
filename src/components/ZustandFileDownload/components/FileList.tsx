import { CHUNK_SIZE, DownloadFile, DownloadStatus } from "../types";
import { Button, Card, Empty, Progress, Space, Spin, Table, Tag, Tooltip, Typography, message } from "antd";
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
import { useFileDownloader } from "../hooks/useFileDownloader";
import { useDownloadStore } from "../store";
import { useShallow } from "zustand/react/shallow";

const { Text } = Typography;

interface FileListProps {
  onRefreshFiles: (forceUpdate?: boolean) => Promise<void>;
}

const isDownloadableStatus = (status: DownloadFile["status"]) =>
  status === DownloadStatus.IDLE ||
  status === DownloadStatus.ERROR ||
  status === DownloadStatus.PAUSED;

const isDeletableStatus = (status: DownloadFile["status"]) =>
  status === DownloadStatus.IDLE || status === DownloadStatus.COMPLETED;

export const FileList: React.FC<FileListProps> = ({ onRefreshFiles }) => {
  const { files, fetchingFiles } = useDownloadStore(
    useShallow((state) => ({
      files: state.files,
      fetchingFiles: state.fetchingFiles,
    }))
  );

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
  const [isBatchOperating, setIsBatchOperating] = useState(false);
  const selectedRowKeySet = useMemo(() => new Set(selectedRowKeys), [selectedRowKeys]);
  const processingFileSet = useMemo(
    () => new Set(processingFiles),
    [processingFiles]
  );

  const runBatchWithConcurrency = useCallback(
    async <T,>(
      items: T[],
      task: (item: T) => Promise<void>,
      concurrency = 3
    ) => {
      if (items.length === 0) {
        return { success: 0, failed: 0 };
      }

      let cursor = 0;
      let success = 0;
      let failed = 0;

      const runner = async () => {
        while (true) {
          const currentIndex = cursor;
          cursor += 1;
          if (currentIndex >= items.length) {
            return;
          }

          const item = items[currentIndex];
          if (item === undefined) {
            continue;
          }

          try {
            await task(item);
            success += 1;
          } catch {
            failed += 1;
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(concurrency, items.length) },
          () => runner()
        )
      );

      return { success, failed };
    },
    []
  );

  const handleBatchDownload = useCallback(async () => {
    const downloadableFiles = files.filter((file) =>
      isDownloadableStatus(file.status)
    );

    if (downloadableFiles.length === 0) {
      message.info("没有可下载的文件");
      return;
    }

    setIsBatchOperating(true);
    try {
      const result = await runBatchWithConcurrency(
        downloadableFiles,
        async (file) => {
          await startDownload(file);
        }
      );

      if (result.failed === 0) {
        message.success(`批量下载已处理 ${result.success} 个文件`);
      } else {
        message.warning(
          `批量下载完成：成功 ${result.success} 个，失败 ${result.failed} 个`
        );
      }
    } finally {
      setSelectedRowKeys([]);
      setIsBatchOperating(false);
    }
  }, [files, runBatchWithConcurrency, startDownload]);

  const handleBatchPause = useCallback(async () => {
    const downloadingFiles = files.filter(
      (file) => file.status === DownloadStatus.DOWNLOADING
    );

    if (downloadingFiles.length === 0) {
      message.info("没有正在下载的文件");
      return;
    }

    setIsBatchOperating(true);
    try {
      const result = await runBatchWithConcurrency(
        downloadingFiles.map((file) => file.id),
        async (fileId) => {
          await pauseDownload(fileId);
        }
      );

      if (result.failed === 0) {
        message.success(`批量暂停已处理 ${result.success} 个文件`);
      } else {
        message.warning(
          `批量暂停完成：成功 ${result.success} 个，失败 ${result.failed} 个`
        );
      }
    } finally {
      setSelectedRowKeys([]);
      setIsBatchOperating(false);
    }
  }, [files, pauseDownload, runBatchWithConcurrency]);

  const handleBatchResume = useCallback(async () => {
    const pausedFiles = files.filter(
      (file) => file.status === DownloadStatus.PAUSED
    );

    if (pausedFiles.length === 0) {
      message.info("没有可继续的文件");
      return;
    }

    setIsBatchOperating(true);
    try {
      const result = await runBatchWithConcurrency(
        pausedFiles.map((file) => file.id),
        async (fileId) => {
          await resumeDownload(fileId);
        }
      );

      if (result.failed === 0) {
        message.success(`批量继续已处理 ${result.success} 个文件`);
      } else {
        message.warning(
          `批量继续完成：成功 ${result.success} 个，失败 ${result.failed} 个`
        );
      }
    } finally {
      setSelectedRowKeys([]);
      setIsBatchOperating(false);
    }
  }, [files, resumeDownload, runBatchWithConcurrency]);

  const handleRefreshFiles = useCallback(async () => {
    if (isRefreshing || fetchingFiles) return;

    setIsRefreshing(true);
    try {
      await onRefreshFiles(true);
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshFiles, isRefreshing, fetchingFiles]);

  const handleDownloadSelected = useCallback(async () => {
    if (selectedRowKeySet.size === 0) return;

    const selectedFiles = files.filter(
      (file) => selectedRowKeySet.has(file.id) && isDownloadableStatus(file.status)
    );

    if (selectedFiles.length === 0) {
      message.info("选中文件中没有可下载项");
      return;
    }

    setIsBatchOperating(true);
    try {
      const result = await runBatchWithConcurrency(
        selectedFiles,
        async (file) => {
          await startDownload(file);
        }
      );
      if (result.failed === 0) {
        message.success(`批量下载（选中）已处理 ${result.success} 个文件`);
      } else {
        message.warning(
          `批量下载（选中）完成：成功 ${result.success} 个，失败 ${result.failed} 个`
        );
      }
    } finally {
      setSelectedRowKeys([]);
      setIsBatchOperating(false);
    }
  }, [files, runBatchWithConcurrency, selectedRowKeySet, startDownload]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedRowKeySet.size === 0) return;

    const selectedFiles = files.filter(
      (file) => selectedRowKeySet.has(file.id) && isDeletableStatus(file.status)
    );

    if (selectedFiles.length === 0) {
      message.info("选中文件中没有可删除项");
      return;
    }

    setIsBatchOperating(true);
    try {
      const result = await runBatchWithConcurrency(
        selectedFiles.map((file) => file.id),
        async (fileId) => {
          await deleteFile(fileId);
        }
      );
      if (result.failed === 0) {
        message.success(`批量删除已处理 ${result.success} 个文件`);
      } else {
        message.warning(
          `批量删除完成：成功 ${result.success} 个，失败 ${result.failed} 个`
        );
      }
    } finally {
      setSelectedRowKeys([]);
      setIsBatchOperating(false);
    }
  }, [deleteFile, files, runBatchWithConcurrency, selectedRowKeySet]);

  const rowSelection = useMemo(
    () => ({
      selectedRowKeys,
      onChange: (selectedKeys: React.Key[]) => {
        setSelectedRowKeys(selectedKeys);
      },
      getCheckboxProps: (record: DownloadFile) => ({
        disabled: processingFileSet.has(record.id),
      }),
    }),
    [processingFileSet, selectedRowKeys]
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
                {formattedChunkSize}/分片
                {isLastChunkDifferent && (
                  <span
                    title={`最后分片大小: ${formatFileSize(lastChunkSize)}`}
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
              statusText = "空闲";
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
          }
          if (record.status === DownloadStatus.ERROR) {
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
        render: (_: unknown, record: DownloadFile) => {
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
    let hasDownloadingFiles = false;
    let hasPausedFiles = false;
    let hasDownloadableFiles = false;
    let hasSelectedDownloadable = false;
    let hasSelectedDeletable = false;

    const hasSelection = selectedRowKeySet.size > 0;

    for (const file of files) {
      if (!hasDownloadingFiles && file.status === DownloadStatus.DOWNLOADING) {
        hasDownloadingFiles = true;
      }

      if (!hasPausedFiles && file.status === DownloadStatus.PAUSED) {
        hasPausedFiles = true;
      }

      if (!hasDownloadableFiles && isDownloadableStatus(file.status)) {
        hasDownloadableFiles = true;
      }

      if (hasSelection && selectedRowKeySet.has(file.id)) {
        if (!hasSelectedDownloadable && isDownloadableStatus(file.status)) {
          hasSelectedDownloadable = true;
        }

        if (!hasSelectedDeletable && isDeletableStatus(file.status)) {
          hasSelectedDeletable = true;
        }
      }

      if (
        hasDownloadingFiles &&
        hasPausedFiles &&
        hasDownloadableFiles &&
        (!hasSelection || (hasSelectedDownloadable && hasSelectedDeletable))
      ) {
        break;
      }
    }

    return {
      hasDownloadableFiles,
      hasDownloadingFiles,
      hasPausedFiles,
      selectionCount: selectedRowKeySet.size,
      hasSelectedDownloadable,
      hasSelectedDeletable,
    };
  }, [files, selectedRowKeySet]);

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
              disabled={!fileStatus.hasSelectedDownloadable || isBatchOperating}
              loading={isBatchOperating}
            />
          </Tooltip>
          <Tooltip title="删除选中">
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleDeleteSelected}
              disabled={!fileStatus.hasSelectedDeletable || isBatchOperating}
              loading={isBatchOperating}
            />
          </Tooltip>
          <Tooltip title="全部下载">
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleBatchDownload}
              disabled={!fileStatus.hasDownloadableFiles || isBatchOperating}
              loading={isBatchOperating}
            />
          </Tooltip>
          <Tooltip title="全部暂停">
            <Button
              icon={<PauseCircleOutlined />}
              onClick={handleBatchPause}
              disabled={!fileStatus.hasDownloadingFiles || isBatchOperating}
              loading={isBatchOperating}
            />
          </Tooltip>
          <Tooltip title="全部继续">
            <Button
              icon={<PlayCircleOutlined />}
              onClick={handleBatchResume}
              disabled={!fileStatus.hasPausedFiles || isBatchOperating}
              loading={isBatchOperating}
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
