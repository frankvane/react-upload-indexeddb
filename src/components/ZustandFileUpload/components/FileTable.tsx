import { Button, Table, Tag, Tooltip } from "antd";
import React, { useMemo } from "react";
import type { FileOperationsActions } from "../hooks/useFileOperations";
import { useEffectiveUploadConfig } from "../hooks/useEffectiveConfig";
import { useUploadStore } from "../store/upload";
import {
  AlignItem,
  UploadFile,
  UploadStatus,
  statusMap,
} from "../types/upload";
import { ByteConvert } from "../utils";
import { useShallow } from "zustand/react/shallow";
import PercentDisplay from "./PercentDisplay";

interface FileTableProps {
  fileOperations: Pick<
    FileOperationsActions,
    "retryingFiles" | "handleDeleteFile" | "handleRetryUpload"
  >;
}

const FileTable: React.FC<FileTableProps> = ({ fileOperations }) => {
  const { files, progressMap, isUploading, isNetworkOffline } = useUploadStore(
    useShallow((state) => ({
      files: state.files,
      progressMap: state.progressMap,
      isUploading: state.isUploading,
      isNetworkOffline: state.isNetworkOffline,
    }))
  );
  const uploadConfig = useEffectiveUploadConfig();
  const isSimpleMode = uploadConfig.uiMode === "simple";
  const { retryingFiles, handleDeleteFile, handleRetryUpload } = fileOperations;

  const rowIndexById = useMemo(
    () => new Map(files.map((file, index) => [file.id, index + 1])),
    [files]
  );

  const dataSource = useMemo(
    () =>
      files.map((file) => ({
        ...file,
        key: file.id,
        progress: progressMap[file.id] ?? file.progress ?? 0,
      })),
    [files, progressMap]
  );

  const columns = useMemo(() => {
    const baseColumns = [
      {
        title: "编号",
        dataIndex: "ID",
        key: "index",
        render: (_: unknown, record: UploadFile) => rowIndexById.get(record.id),
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
          const statusItem = statusMap[status] || { text: status, color: "default" };
          return <Tag color={statusItem.color}>{statusItem.text}</Tag>;
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
          return <PercentDisplay percent={record.progress} status="normal" />;
        },
        align: "center" as AlignItem,
        width: isSimpleMode ? "20%" : "15%",
      },
    ];

    if (isSimpleMode) {
      return baseColumns;
    }

    return [
      ...baseColumns,
      {
        title: "操作",
        dataIndex: "action",
        key: "action",
        render: (_: unknown, record: UploadFile) => {
          const { status, id } = record;
          const isRetrying = retryingFiles[id] || false;
          const isActionDisabled = isUploading || isRetrying || isNetworkOffline;

          return (
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {status === UploadStatus.ERROR && (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => handleRetryUpload(record)}
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
                onClick={() => handleDeleteFile(id)}
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
  }, [
    rowIndexById,
    isSimpleMode,
    retryingFiles,
    isUploading,
    isNetworkOffline,
    handleRetryUpload,
    handleDeleteFile,
  ]);

  return (
    <Table
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      bordered
      style={{ marginTop: 16 }}
    />
  );
};

export default FileTable;
