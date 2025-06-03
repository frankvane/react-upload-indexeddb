import "antd/dist/reset.css";

import { AlignItem, UploadFile, UploadStatus, statusMap } from "./types/upload";
import { Button, Switch, Table, Tag, Tooltip, message } from "antd";
import React, { useEffect, useRef, useState } from "react";

import { ByteConvert } from "./utils";
import NetworkStatusBadge from "./components/NetworkStatusBadge";
import PercentDisplay from "./components/PercentDisplay";
import StorageStatsDrawer from "./components/StorageStatsDrawer";
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
  const [retryingFiles, setRetryingFiles] = useState<Record<string, boolean>>(
    {}
  );
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const [previousNetworkState, setPreviousNetworkState] = useState<
    string | null
  >(null);
  const [networkDisplayMode, setNetworkDisplayMode] = useState<
    "tooltip" | "direct"
  >("direct");
  const [storageStatsVisible, setStorageStatsVisible] = useState(false);

  const { files: allFiles, refresh: refreshFiles } = useIndexedDBFiles();

  // 使用网络类型钩子获取动态参数
  const { networkType, fileConcurrency, chunkConcurrency, chunkSize } =
    useNetworkType();

  // 检查网络是否断开
  const isNetworkOffline = networkType === "offline";

  // 将 fileConcurrency 传递给 useBatchUploader
  const {
    uploadAll,
    batchInfo,
    isUploading,
    cancelUpload,
    clearBatchInfo,
    retryUploadFile,
    retryAllFailedFiles,
  } = useBatchUploader({
    setProgressMap,
    fileConcurrency,
    chunkConcurrency,
    maxRetries: 3, // 默认重试次数
    timeout: 30000, // 默认超时时间（毫秒）
    retryInterval: 1000, // 重试间隔时间（毫秒）
    refreshFiles,
  });

  const filePrepareWorkerUrl = new URL(
    "./worker/filePrepareWorker.ts",
    import.meta.url
  ).href;

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  // 打开存储统计抽屉
  const showStorageStats = () => {
    setStorageStatsVisible(true);
  };

  // 关闭存储统计抽屉
  const closeStorageStats = () => {
    setStorageStatsVisible(false);
  };

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
    try {
      // 设置该文件为重试中状态
      setRetryingFiles((prev) => ({ ...prev, [file.id]: true }));

      const result = await retryUploadFile(file);

      if (result.success) {
        // 重试成功，显示提示消息
        messageApi.success(
          result.message || `文件 ${file.fileName} 重试上传成功`
        );
      } else {
        messageApi.error(
          result.message || `文件 ${file.fileName} 重试上传失败`
        );
      }
    } catch (error) {
      console.error("重试上传失败:", error);
      messageApi.error(
        `上传出错: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // 清除重试状态
      setRetryingFiles((prev) => {
        const updated = { ...prev };
        delete updated[file.id];
        return updated;
      });
    }
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

  // 计算错误文件数量
  const errorFilesCount = allFiles.filter(
    (file) => file.status === UploadStatus.ERROR
  ).length;

  // 按钮标题
  const retryButtonTitle =
    errorFilesCount > 0 ? `批量重试 (${errorFilesCount})` : "批量重试";

  // 查找是否有错误状态的文件
  const hasErrorFiles = allFiles.some(
    (file) => file.status === UploadStatus.ERROR
  );

  // 批量重试所有失败的文件
  const handleRetryAllUpload = async () => {
    if (errorFilesCount === 0) {
      messageApi.info("没有需要重试的文件");
      return;
    }

    try {
      setIsRetryingAll(true);
      const result = await retryAllFailedFiles();

      if (result.retriedCount === 0) {
        messageApi.info(result.message);
      } else if (result.success) {
        messageApi.success(result.message);
      } else {
        messageApi.error(result.message);
      }
    } catch (error) {
      console.error("批量重试失败:", error);
      messageApi.error(
        `批量重试出错: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setIsRetryingAll(false);
    }
  };

  const handleClearUploadedFiles = async () => {
    try {
      // 获取所有已上传完成的文件
      const completedFiles = allFiles.filter(
        (file) =>
          file.status === UploadStatus.DONE ||
          file.status === UploadStatus.INSTANT
      );
      if (completedFiles.length === 0) {
        messageApi.info("没有已上传完成的文件需要清除");
        return;
      }

      // 删除已上传完成的文件
      for (const file of completedFiles) {
        await localforage.removeItem(file.id);
      }
      await refreshFiles();
      // 显示成功消息
      messageApi.success(`已清除 ${completedFiles.length} 个已上传完成的文件`);
    } catch (error) {
      console.error("清除已上传文件失败:", error);
      messageApi.error(
        `清除已上传文件失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  useEffect(() => {
    if (!batchInfo) return;
    if (batchInfo.current === batchInfo.total) {
      const timer = setTimeout(() => {
        handleClearUploadedFiles();
      }, 3000);

      return () => {
        clearTimeout(timer);
      };
    }
  }, [allFiles]);

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
    {
      title: "编号",
      dataIndex: "ID",
      key: "index",
      render: (_: unknown, record: UploadFile) => {
        const index = allFiles.findIndex((f) => f.id === record.id);
        return index + 1;
      },
      align: "center" as AlignItem,
      width: "5%",
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

  // 在网络状态变化时显示提示和处理
  useEffect(() => {
    // 保存之前的网络状态
    if (previousNetworkState !== networkType) {
      // 网络从离线到在线
      if (previousNetworkState === "offline" && networkType !== "offline") {
        messageApi.success(`网络已恢复 (${networkType})，正在自动恢复上传任务`);

        // 将处理逻辑延迟一秒，确保UI更新和用户能看到提示
        setTimeout(() => {
          // 对所有文件按状态分类
          const errorFiles = allFiles.filter(
            (file) =>
              file.status === UploadStatus.ERROR ||
              file.status === UploadStatus.MERGE_ERROR
          );
          const pendingFiles = allFiles.filter(
            (file) =>
              file.status === UploadStatus.CALCULATING ||
              file.status === UploadStatus.UPLOADING ||
              file.status === UploadStatus.QUEUED ||
              file.status === UploadStatus.QUEUED_FOR_UPLOAD ||
              file.status === UploadStatus.PREPARING_UPLOAD
          );
          const waitingFiles = allFiles.filter(
            (file) => file.status === UploadStatus.PAUSED
          );
          const completedFiles = allFiles.filter(
            (file) =>
              file.status === UploadStatus.DONE ||
              file.status === UploadStatus.INSTANT
          );

          // 统计各类文件数量
          const totalErrors = errorFiles.length;
          const totalPending = pendingFiles.length;
          const totalWaiting = waitingFiles.length;
          const totalToProcess = totalErrors + totalPending + totalWaiting;

          console.log("网络恢复后文件状态:", {
            errorFiles: totalErrors,
            pendingFiles: totalPending,
            waitingFiles: totalWaiting,
            completedFiles: completedFiles.length,
            totalToProcess,
          });

          // 如果没有需要处理的文件，直接退出
          if (totalToProcess === 0) {
            messageApi.info("没有需要上传的文件");
            return;
          }

          // 处理策略：先重试错误文件，然后继续上传所有其他文件

          // 如果有错误文件，先重试
          if (totalErrors > 0) {
            messageApi.info(`正在重试 ${totalErrors} 个失败文件...`);

            // 直接调用 retryAllFailedFiles 而不是通过 handleRetryAllUpload
            setIsRetryingAll(true);
            retryAllFailedFiles()
              .then((result) => {
                if (result.success) {
                  messageApi.success(result.message);
                } else {
                  messageApi.error(result.message);
                }
              })
              .catch((error) => {
                console.error("自动重试失败:", error);
                messageApi.error(
                  `自动重试出错: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
              })
              .finally(() => {
                setIsRetryingAll(false);

                // 重试完成后，如果还有待上传的文件，继续上传所有文件
                if (totalPending + totalWaiting > 0) {
                  messageApi.info(
                    `继续上传 ${totalPending + totalWaiting} 个排队中的文件...`
                  );
                  // 等待一小段时间再上传，避免UI更新冲突
                  setTimeout(() => {
                    uploadAll();
                  }, 500);
                }
              });
          }
          // 如果没有错误文件但有其他待处理文件，直接继续上传
          else if (totalPending + totalWaiting > 0) {
            messageApi.info(
              `继续上传 ${totalPending + totalWaiting} 个文件...`
            );
            uploadAll();
          }
        }, 1000);
      }
      // 网络从在线到离线
      else if (
        previousNetworkState !== "offline" &&
        networkType === "offline"
      ) {
        messageApi.error("网络已断开，上传操作已暂停");

        // 如果正在上传，则取消上传
        if (isUploading) {
          cancelUpload();
          messageApi.warning("由于网络断开，上传已取消");
        }
      }

      // 更新之前的网络状态
      setPreviousNetworkState(networkType);
    }
  }, [
    networkType,
    previousNetworkState,
    messageApi,
    allFiles,
    isUploading,
    cancelUpload,
    uploadAll,
    retryAllFailedFiles,
    setIsRetryingAll,
  ]);

  return (
    <div>
      {contextHolder}

      <div
        style={{
          marginTop: 16,
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={isNetworkOffline}
          title={isNetworkOffline ? "网络已断开，无法选择文件" : ""}
        >
          选择文件
        </Button>
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
          disabled={
            allFiles.length === 0 ||
            isUploading ||
            isRetryingAll ||
            isNetworkOffline
          }
          title={isNetworkOffline ? "网络已断开，无法上传" : ""}
        >
          上传文件
        </Button>

        <Button
          type="primary"
          danger
          onClick={handleClearList}
          disabled={allFiles.length === 0 || isUploading || isRetryingAll}
        >
          清除列表
        </Button>

        <Tooltip
          title={
            isNetworkOffline
              ? "网络已断开，无法重试"
              : errorFilesCount > 0
              ? `重试 ${errorFilesCount} 个失败文件`
              : "没有需要重试的文件"
          }
        >
          <Button
            type="primary"
            onClick={handleRetryAllUpload}
            disabled={
              !hasErrorFiles || isUploading || isRetryingAll || isNetworkOffline
            }
            loading={isRetryingAll}
          >
            {isRetryingAll ? "重试中..." : retryButtonTitle}
          </Button>
        </Tooltip>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <NetworkStatusBadge
            networkType={networkType}
            chunkSize={chunkSize}
            fileConcurrency={fileConcurrency}
            chunkConcurrency={chunkConcurrency}
            isOffline={isNetworkOffline}
            displayMode={networkDisplayMode}
          />

          <Tooltip
            title={`切换为${
              networkDisplayMode === "direct" ? "悬停提示" : "直接显示"
            }模式`}
          >
            <Switch
              checkedChildren="详细"
              unCheckedChildren="简洁"
              checked={networkDisplayMode === "direct"}
              onChange={(checked) =>
                setNetworkDisplayMode(checked ? "direct" : "tooltip")
              }
              size="small"
              style={{ marginLeft: 8 }}
            />
          </Tooltip>

          <Button type="dashed" size="small" onClick={showStorageStats}>
            存储统计
          </Button>
        </div>

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

      {/* 存储统计抽屉 */}
      <StorageStatsDrawer
        visible={storageStatsVisible}
        onClose={closeStorageStats}
      />
    </div>
  );
};

export default FileUpload;
