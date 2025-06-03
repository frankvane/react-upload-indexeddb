import "antd/dist/reset.css";

import { AlignItem, UploadFile, UploadStatus, statusMap } from "./types/upload";
import { Button, Table, Tag, Tooltip } from "antd";
import React, { useEffect, useRef, useState } from "react";

import { ByteConvert } from "./utils";
import NetworkStatusBadge from "./components/NetworkStatusBadge";
import PercentDisplay from "./components/PercentDisplay";
import localforage from "localforage";
import { useBatchUploader } from "./hooks/useBatchUploader";
import { useIndexedDBFiles } from "./hooks/useIndexedDBFiles";
import { useNetworkType } from "./hooks/useNetworkType";

localforage.config({
  name: "upload-indexeddb",
  storeName: "upload_files",
});

const FileUpload = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [processProgress, setProcessProgress] = useState<{
    processed: number;
    total: number;
    success: number;
    failed: number;
    oversized: number;
  } | null>(null);

  const { files: allFiles, refresh: refreshFiles } = useIndexedDBFiles();

  // 使用网络类型钩子获取动态参数
  const { networkType, fileConcurrency, chunkConcurrency, chunkSize } =
    useNetworkType();

  // 将 fileConcurrency 传递给 useBatchUploader
  const { uploadAll, batchInfo, isUploading, cancelUpload, clearBatchInfo } =
    useBatchUploader({
      setProgressMap,
      refreshFiles,
      fileConcurrency,
      chunkConcurrency,
      maxRetries: 3, // 默认重试次数
      timeout: 30000, // 默认超时时间（毫秒）
      retryInterval: 1000, // 重试间隔时间（毫秒）
    });

  const filePrepareWorkerUrl = new URL(
    "./worker/filePrepareWorker.ts",
    import.meta.url
  ).href;

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setLoading(true);
    setCost(null);
    const start = Date.now();

    // 初始化处理进度
    setProcessProgress({
      processed: 0,
      total: files.length,
      success: 0,
      failed: 0,
      oversized: 0,
    });

    const worker = new Worker(filePrepareWorkerUrl);

    // 将网络参数传递给worker
    worker.postMessage({
      files,
      networkParams: {
        chunkSize,
        chunkConcurrency,
        fileConcurrency,
        networkType,
      },
    });

    worker.onmessage = async (event) => {
      const data = event.data;

      if (data.type === "progress") {
        // 处理进度更新
        setProcessProgress({
          processed: data.processed,
          total: data.total,
          success: data.success,
          failed: data.failed,
          oversized: data.oversized,
        });
      } else if (data.type === "complete") {
        // 处理完成
        const { uploadFiles } = data;
        for (const uploadFile of uploadFiles) {
          await localforage.setItem(uploadFile.id, uploadFile);
        }
        await refreshFiles();
        const end = Date.now();
        setCost(end - start);
        setLoading(false);
        setTimeout(() => {
          setCost(null);
          setProcessProgress(null);
        }, 3000);
      }
    };
  };

  const handleDeleteFile = async (id: string) => {
    await localforage.removeItem(id);
    await refreshFiles();
  };

  const handleRetryUpload = async (file: UploadFile) => {
    // Implement retry logic here
    console.log("Retrying upload for", file.fileName);
  };

  const handleClearList = async () => {
    setLoading(true);
    try {
      // 清空IndexedDB存储
      await localforage.clear();
      // 刷新文件列表
      await refreshFiles();
      // 重置进度映射
      setProgressMap({});
    } catch (error) {
      console.error("清空文件列表失败:", error);
    } finally {
      setLoading(false);
    }
  };

  // 渲染批量上传进度信息
  const renderBatchInfo = () => {
    if (!batchInfo) return null;

    return (
      <div style={{ marginBottom: 16, color: "#722ED1" }}>
        <div style={{ marginBottom: 4 }}>
          批量上传进度：{batchInfo.current}/{batchInfo.total}
        </div>
        <div style={{ fontSize: "12px", color: "#666" }}>
          <span style={{ marginRight: 16 }}>
            活跃: <Tag color="processing">{batchInfo.active}</Tag>
          </span>
          <span style={{ marginRight: 16 }}>
            等待: <Tag color="default">{batchInfo.queued}</Tag>
          </span>
          <span style={{ marginRight: 16 }}>
            完成: <Tag color="success">{batchInfo.completed}</Tag>
          </span>
          {batchInfo.failed > 0 && (
            <span style={{ marginRight: 16 }}>
              失败:
              <Tag color="error">{batchInfo.failed}</Tag>
            </span>
          )}
          {batchInfo.retried > 0 && (
            <span style={{ marginRight: 16 }}>
              重试:
              <Tag color="warning">{batchInfo.retried}</Tag>
            </span>
          )}
          {isUploading && (
            <Button
              size="small"
              danger
              style={{ marginLeft: 16 }}
              onClick={cancelUpload}
            >
              取消上传
            </Button>
          )}
          {!isUploading && batchInfo.current === batchInfo.total && (
            <Button
              size="small"
              style={{ marginLeft: 16 }}
              onClick={clearBatchInfo}
            >
              清除记录
            </Button>
          )}
        </div>
      </div>
    );
  };

  // Table columns 配置
  const columns = [
    { title: "文件名", dataIndex: "fileName", key: "fileName" },
    {
      title: "大小",
      dataIndex: "fileSize",
      key: "fileSize",
      render: (size: number) => `${ByteConvert(size)}`,
      align: "right" as AlignItem,
      width: "15%",
    },
    {
      title: "分片数",
      dataIndex: "chunkCount",
      key: "chunkCount",
      align: "right" as AlignItem,
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

        return (
          <div
            style={{ display: "flex", gap: "8px", justifyContent: "center" }}
          >
            {status === UploadStatus.ERROR && (
              <Button
                size="small"
                type="primary"
                onClick={() => handleRetryUpload(record)}
              >
                重试
              </Button>
            )}
            <Button size="small" danger onClick={() => handleDeleteFile(id)}>
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
    <div>
      <div
        style={{
          marginTop: 16,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Button onClick={() => inputRef.current?.click()}>选择文件</Button>
        <input
          type="file"
          ref={inputRef}
          onChange={handleFileChange}
          multiple
          style={{ display: "none" }}
        />
        <Button
          type="primary"
          onClick={uploadAll}
          disabled={allFiles.length === 0 || isUploading}
        >
          上传文件
        </Button>

        <Button
          type="primary"
          danger
          onClick={handleClearList}
          disabled={allFiles.length === 0 || isUploading}
        >
          清除列表
        </Button>

        <NetworkStatusBadge
          networkType={networkType}
          chunkSize={chunkSize}
          fileConcurrency={fileConcurrency}
          chunkConcurrency={chunkConcurrency}
          isOffline={networkType === "offline"}
        />

        {loading && processProgress && (
          <div
            style={{
              marginLeft: 8,
              color: "#1890ff",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span style={{ marginRight: 8 }}>
              处理中: {processProgress.processed}/{processProgress.total}
            </span>
            {processProgress.success > 0 && (
              <span style={{ color: "#52c41a", marginRight: 8 }}>
                成功: {processProgress.success}
              </span>
            )}
            {processProgress.failed > 0 && (
              <span style={{ color: "#f5222d", marginRight: 8 }}>
                失败: {processProgress.failed}
              </span>
            )}
            {processProgress.oversized > 0 && (
              <span style={{ color: "#fa8c16" }}>
                超大: {processProgress.oversized}
              </span>
            )}
          </div>
        )}

        {!loading && cost !== null && (
          <span style={{ color: "green", marginLeft: 8 }}>
            操作耗时：{cost} ms
          </span>
        )}
      </div>

      {renderBatchInfo()}

      {allFiles.length > 0 && (
        <Table
          columns={columns}
          dataSource={allFiles.map((f) => ({
            ...f,
            key: f.id,
            progress: progressMap[f.id] ?? f.progress ?? 0,
          }))}
          pagination={false}
          bordered
          style={{ marginTop: 16 }}
        />
      )}
    </div>
  );
};

export default FileUpload;
