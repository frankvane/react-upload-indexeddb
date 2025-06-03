import {
  AlignItem,
  UploadFile,
  UploadStatus,
  statusMap,
} from "../types/upload";
import { Button, Table, Tag, Tooltip } from "antd";

import { ByteConvert } from "../utils";
import PercentDisplay from "./PercentDisplay";
import React from "react";

interface FileTableProps {
  files: UploadFile[];
  progressMap: Record<string, number>;
  retryingFiles: Record<string, boolean>;
  isUploading: boolean;
  isNetworkOffline: boolean;
  onDeleteFile: (id: string) => Promise<void>;
  onRetryUpload: (file: UploadFile) => Promise<void>;
}

const FileTable: React.FC<FileTableProps> = ({
  files,
  progressMap,
  retryingFiles,
  isUploading,
  isNetworkOffline,
  onDeleteFile,
  onRetryUpload,
}) => {
  // Table columns 配置
  const columns = [
    {
      title: "编号",
      dataIndex: "ID",
      key: "index",
      render: (_: unknown, record: UploadFile) => {
        const index = files.findIndex((f) => f.id === record.id);
        return index + 1;
      },
      align: "center" as AlignItem,
      width: "10%",
    },
    { title: "文件名", dataIndex: "fileName", key: "fileName" },
    {
      title: "大小",
      dataIndex: "fileSize",
      key: "fileSize",
      render: (size: number) => `${ByteConvert(size)}`,
      align: "right" as AlignItem,
      width: "10%",
    },
    {
      title: "分片数",
      dataIndex: "chunkCount",
      key: "chunkCount",
      align: "center" as AlignItem,
      width: "10%",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        const s = statusMap[status] || { text: status, color: "default" };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
      align: "center" as AlignItem,
      width: "10%",
    },
    {
      title: "进度",
      dataIndex: "progress",
      key: "progress",
      render: (_: unknown, record: UploadFile) => {
        if (
          record.status === UploadStatus.DONE ||
          record.status === UploadStatus.INSTANT
        ) {
          return <PercentDisplay percent={100} status="success" />;
        }
        if (
          record.status === UploadStatus.ERROR ||
          record.status === UploadStatus.MERGE_ERROR
        ) {
          return <PercentDisplay percent={record.progress} status="error" />;
        }
        if (record.status === UploadStatus.CALCULATING) {
          return (
            <Tooltip title={`MD5计算进度: ${record.progress}%`}>
              <PercentDisplay percent={record.progress} status="active" />
            </Tooltip>
          );
        }
        if (record.status === UploadStatus.UPLOADING) {
          return <PercentDisplay percent={record.progress} status="active" />;
        }
        // 其他状态
        return <PercentDisplay percent={record.progress} status="normal" />;
      },
      align: "center" as AlignItem,
      width: "15%",
    },
    {
      title: "操作",
      dataIndex: "action",
      key: "action",
      render: (_: unknown, record: UploadFile) => {
        const { status, id } = record;
        const isRetrying = retryingFiles[id] || false;

        // 文件是否可以进行操作（网络断开时禁用操作）
        const isActionDisabled = isUploading || isRetrying || isNetworkOffline;

        return (
          <div
            style={{ display: "flex", gap: "8px", justifyContent: "center" }}
          >
            {status === UploadStatus.ERROR && (
              <Button
                size="small"
                type="primary"
                onClick={() => onRetryUpload(record)}
                loading={isRetrying}
                disabled={isActionDisabled}
                title={isNetworkOffline ? "网络已断开，无法重试" : ""}
              >
                {isRetrying ? "重试中" : "重试"}
              </Button>
            )}
            <Button
              size="small"
              danger
              onClick={() => onDeleteFile(id)}
              disabled={isRetrying || isUploading}
            >
              删除
            </Button>
          </div>
        );
      },
      align: "center" as AlignItem,
      width: "15%",
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={files.map((f) => ({
        ...f,
        key: f.id,
        progress: progressMap[f.id] ?? f.progress ?? 0,
      }))}
      pagination={false}
      bordered
      style={{ marginTop: 16 }}
    />
  );
};

export default FileTable;
