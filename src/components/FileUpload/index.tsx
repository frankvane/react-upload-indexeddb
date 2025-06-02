import "antd/dist/reset.css";

import { AlignItem, UploadFile, UploadStatus, statusMap } from "./types/upload";
import { Button, Modal, Progress, Table, Tag } from "antd";
import React, { useEffect, useRef, useState } from "react";

import { ByteConvert } from "./utils";
import NetworkStatusBadge from "./components/NetworkStatusBadge";
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
  const { files: allFiles, refresh: refreshFiles } = useIndexedDBFiles();
  const { uploadAll, batchInfo } = useBatchUploader({
    setProgressMap,
    refreshFiles,
  });

  // 使用网络类型钩子获取动态参数
  const { networkType, fileConcurrency, chunkConcurrency, chunkSize } =
    useNetworkType();

  const filePrepareWorkerUrl = new URL(
    "./worker/filePrepareWorker.ts",
    import.meta.url
  ).href;

  const [processProgress, setProcessProgress] = useState<{
    processed: number;
    total: number;
    success: number;
    failed: number;
    oversized: number;
  } | null>(null);

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
    Modal.confirm({
      title: "确认清空",
      content: "确定要清空所有文件列表吗？此操作无法撤销。",
      okText: "确定",
      okType: "danger",
      cancelText: "取消",
      async onOk() {
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
      },
    });
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
      render: (progress: number) => (
        <Progress percent={progress} size="small" />
      ),
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
          disabled={allFiles.length === 0}
        >
          上传文件
        </Button>

        <Button
          type="primary"
          danger
          onClick={handleClearList}
          disabled={allFiles.length === 0}
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

      {batchInfo && (
        <div style={{ marginBottom: 16, color: "#722ED1" }}>
          批量上传进度：{batchInfo.current}/{batchInfo.total}
        </div>
      )}

      {allFiles.length > 0 && (
        <Table
          columns={columns}
          dataSource={allFiles.map((f) => ({
            ...f,
            key: f.id,
            progress: progressMap[f.id] ?? 0,
          }))}
          pagination={false}
          bordered
          style={{ marginTop: 16 }}
          loading={loading}
        />
      )}
    </div>
  );
};

export default FileUpload;
