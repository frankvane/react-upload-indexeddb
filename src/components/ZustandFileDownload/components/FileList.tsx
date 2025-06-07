import { Button, Progress, Tag, Typography } from "antd";
import { Card, Empty, Space, Spin, Table } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { DownloadFile, DownloadStatus } from "../types";
import React, { useMemo, useState } from "react";

import { formatFileSize } from "../utils";
import { useDownloadFiles } from "../hooks/useDownloadFiles";
import { useFileDownloader } from "../hooks/useFileDownloader";

const { Text } = Typography;

/**
 * 文件列表组件
 */
export const FileList: React.FC = () => {
  // 直接从store获取状态和方法
  const { files, fetchingFiles } = useDownloadFiles();
  const {
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteFile,
    exportFile,
    processingFiles,
  } = useFileDownloader();

  // 添加选中的文件ID状态
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 批量下载处理函数
  const handleBatchDownload = () => {
    // 过滤出选中的文件
    const selectedFiles = files.filter(
      (file) =>
        selectedRowKeys.includes(file.id) &&
        (file.status === DownloadStatus.IDLE ||
          file.status === DownloadStatus.ERROR ||
          file.status === DownloadStatus.PAUSED)
    );

    // 依次下载选中的文件
    selectedFiles.forEach((file) => {
      startDownload(file);
    });

    // 下载开始后清空选择
    setSelectedRowKeys([]);
  };

  // 行选择配置
  const rowSelection = {
    selectedRowKeys,
    onChange: (selectedKeys: React.Key[]) => {
      setSelectedRowKeys(selectedKeys);
    },
    getCheckboxProps: (record: DownloadFile) => ({
      // 正在下载或已完成的文件不可选
      disabled:
        record.status === DownloadStatus.DOWNLOADING ||
        record.status === DownloadStatus.PREPARING ||
        record.status === DownloadStatus.COMPLETED,
    }),
  };

  // 表格列定义
  const columns = useMemo(
    () => [
      {
        title: "文件名",
        dataIndex: "fileName",
        key: "fileName",
        ellipsis: true,
        width: "30%",
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
        width: "15%",
        render: (size: number) => formatFileSize(size),
      },
      {
        title: "状态",
        dataIndex: "status",
        key: "status",
        width: "15%",
        render: (
          status: (typeof DownloadStatus)[keyof typeof DownloadStatus],
          record: DownloadFile
        ) => {
          const isProcessing = processingFiles.includes(record.id);

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
              {isProcessing && <Text type="secondary">处理中...</Text>}
            </Space>
          );
        },
      },
      {
        title: "进度",
        dataIndex: "progress",
        key: "progress",
        width: "20%",
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
        width: "20%",
        render: (_: any, record: DownloadFile) => {
          const isDownloading = record.status === DownloadStatus.DOWNLOADING;
          const isPaused = record.status === DownloadStatus.PAUSED;
          const isCompleted = record.status === DownloadStatus.COMPLETED;
          const isPreparing = record.status === DownloadStatus.PREPARING;
          const isIdle = record.status === DownloadStatus.IDLE;

          return (
            <Space>
              {/* 下载/暂停/继续/导出按钮 */}
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

              {/* 取消/删除按钮 */}
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

  // 计算是否有可下载的文件被选中
  const hasDownloadableSelected = useMemo(() => {
    return (
      selectedRowKeys.length > 0 &&
      files.some(
        (file) =>
          selectedRowKeys.includes(file.id) &&
          (file.status === DownloadStatus.IDLE ||
            file.status === DownloadStatus.ERROR ||
            file.status === DownloadStatus.PAUSED)
      )
    );
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
          {selectedRowKeys.length > 0 && (
            <Text type="secondary">已选择 {selectedRowKeys.length} 个文件</Text>
          )}
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleBatchDownload}
            disabled={!hasDownloadableSelected}
          >
            批量下载
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
