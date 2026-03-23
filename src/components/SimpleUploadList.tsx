import { ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Card, Modal, Space, Table, Typography, message } from "antd";
import axios from "axios";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ZustandFileUpload from "./ZustandFileUpload";
import type { UploadFile } from "./ZustandFileUpload/types/upload";
import { API_BASE_URL, API_PATHS } from "../config/api";
import { removeUploadFilesByIds } from "./ZustandFileUpload/services/uploadStorage";

const normalizePath = (path: string | undefined, fallback: string) => {
  if (!path) {
    return fallback;
  }
  return path.startsWith("/") ? path : `/${path}`;
};

const formatFileSize = (size: number) => {
  if (!Number.isFinite(size) || size < 0) {
    return "-";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatCreatedAt = (value?: string | number) => {
  if (value === undefined || value === null) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
};

interface FileListEnvelope {
  code: number;
  message?: string;
  data: {
    total: number;
    files: SimpleServerFile[];
  };
}

export interface SimpleServerFile {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileExt?: string;
  thumbnailUrl?: string | null;
  md5?: string;
  createdAt?: string | number;
}

export interface SimpleUploadListProps {
  baseURL?: string;
  uploadApi?: string;
  checkApi?: string;
  listApi?: string;
  onServerListChange?: (files: SimpleServerFile[]) => void;
}

const SimpleUploadList: React.FC<SimpleUploadListProps> = ({
  baseURL = API_BASE_URL,
  uploadApi = API_PATHS.file.upload,
  checkApi = API_PATHS.file.instant,
  listApi = API_PATHS.file.list,
  onServerListChange,
}) => {
  const [files, setFiles] = useState<SimpleServerFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const normalizedListApi = useMemo(
    () => normalizePath(listApi, API_PATHS.file.list),
    [listApi]
  );
  const normalizedUploadApi = useMemo(
    () => normalizePath(uploadApi, API_PATHS.file.upload),
    [uploadApi]
  );
  const normalizedCheckApi = useMemo(
    () => normalizePath(checkApi, API_PATHS.file.instant),
    [checkApi]
  );

  const apiClient = useMemo(
    () =>
      axios.create({
        baseURL: baseURL || undefined,
        timeout: 30000,
      }),
    [baseURL]
  );

  const isRefreshingRef = useRef(false);
  const queuedRefreshRef = useRef(false);
  const currentBatchFileIdsRef = useRef<Set<string>>(new Set());

  const fetchServerFiles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<FileListEnvelope>(normalizedListApi);
      const payload = response.data;
      if (payload.code !== 200) {
        throw new Error(payload.message || "获取文件清单失败");
      }
      const latestFiles = payload.data?.files ?? [];
      setFiles(latestFiles);
      onServerListChange?.(latestFiles);
    } catch (error) {
      console.error("failed to refresh server file list", error);
      message.error("刷新文件清单失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [apiClient, normalizedListApi, onServerListChange]);

  const refreshServerFiles = useCallback(async () => {
    if (isRefreshingRef.current) {
      queuedRefreshRef.current = true;
      return;
    }

    isRefreshingRef.current = true;
    try {
      do {
        queuedRefreshRef.current = false;
        await fetchServerFiles();
      } while (queuedRefreshRef.current);
    } finally {
      isRefreshingRef.current = false;
    }
  }, [fetchServerFiles]);

  useEffect(() => {
    void refreshServerFiles();
  }, [refreshServerFiles]);

  const handleUploadComplete = useCallback(
    (_file: UploadFile, success: boolean) => {
      if (!success) {
        return;
      }
      void refreshServerFiles();
    },
    [refreshServerFiles]
  );

  const handleUploadStart = useCallback((uploadFiles: UploadFile[]) => {
    currentBatchFileIdsRef.current = new Set(uploadFiles.map((file) => file.id));
  }, []);

  const handleBatchComplete = useCallback(() => {
    const batchIds = Array.from(currentBatchFileIdsRef.current);
    currentBatchFileIdsRef.current.clear();

    void (async () => {
      await removeUploadFilesByIds(batchIds);
      setModalOpen(false);
    })();
  }, []);

  const columns = useMemo(
    () => [
      {
        title: "文件名",
        dataIndex: "fileName",
        key: "fileName",
        ellipsis: true,
      },
      {
        title: "大小",
        dataIndex: "fileSize",
        key: "fileSize",
        width: 120,
        render: (size: number) => formatFileSize(size),
      },
      {
        title: "类型",
        dataIndex: "fileType",
        key: "fileType",
        width: 180,
        ellipsis: true,
        render: (value: string) => value || "-",
      },
      {
        title: "上传时间",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 200,
        render: (value: string | number | undefined) => formatCreatedAt(value),
      },
    ],
    []
  );

  return (
    <>
      <Card
        title="上传文件清单"
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void refreshServerFiles();
              }}
              loading={loading}
            >
              刷新
            </Button>
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setModalOpen(true)}
            >
              上传文件
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={files}
          loading={loading}
          pagination={false}
          scroll={{ x: 800 }}
          locale={{ emptyText: "暂无已上传文件" }}
        />
      </Card>

      <Modal
        title="上传文件"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={960}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          选择文件后会自动上传，上传成功后会自动刷新左侧清单。
        </Typography.Paragraph>

        <ZustandFileUpload
          baseURL={baseURL}
          uploadApi={normalizedUploadApi}
          checkApi={normalizedCheckApi}
          chunkSize={1024 * 1024}
          fileConcurrency={2}
          chunkConcurrency={2}
          maxRetries={3}
          maxFileSize={100 * 1024 * 1024}
          allowedFileTypes={[]}
          maxFiles={10}
          autoUpload={true}
          autoCleanup={true}
          cleanupDelay={5}
          networkDisplayMode="tooltip"
          uiMode="simple"
          settingsSource="props"
          onUploadStart={handleUploadStart}
          onUploadComplete={handleUploadComplete}
          onBatchComplete={handleBatchComplete}
        />
      </Modal>
    </>
  );
};

export default SimpleUploadList;
