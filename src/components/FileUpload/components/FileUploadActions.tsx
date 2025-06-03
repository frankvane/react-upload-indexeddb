import { Button, Switch, Tooltip } from "antd";

import { BarChartOutlined } from "@ant-design/icons";
import NetworkStatusBadge from "./NetworkStatusBadge";
import React from "react";

interface ProcessProgress {
  processed: number;
  total: number;
  success: number;
  failed: number;
  oversized: number;
}

interface RetryResult {
  success: boolean;
  message: string;
  retriedCount: number;
}

interface FileUploadActionsProps {
  triggerFileInput: () => void;
  uploadAll: () => Promise<boolean>;
  clearList: () => Promise<boolean>;
  retryAllUpload: () => Promise<RetryResult>;
  showStorageStats: () => void;
  loading: boolean;
  cost: number | null;
  processProgress: ProcessProgress | null;
  allFilesCount: number;
  errorFilesCount: number;
  isUploading: boolean;
  isRetryingAll: boolean;
  isNetworkOffline: boolean;
  autoUpload: boolean;
  setAutoUpload: (value: boolean) => void;
  networkType: string;
  chunkSize: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  networkDisplayMode: "tooltip" | "direct";
  setNetworkDisplayMode: (mode: "tooltip" | "direct") => void;
}

const FileUploadActions: React.FC<FileUploadActionsProps> = ({
  triggerFileInput,
  uploadAll,
  clearList,
  retryAllUpload,
  showStorageStats,
  loading,
  cost,
  processProgress,
  allFilesCount,
  errorFilesCount,
  isUploading,
  isRetryingAll,
  isNetworkOffline,
  autoUpload,
  setAutoUpload,
  networkType,
  chunkSize,
  fileConcurrency,
  chunkConcurrency,
  networkDisplayMode,
  setNetworkDisplayMode,
}) => {
  // 按钮标题
  const retryButtonTitle =
    errorFilesCount > 0 ? `批量重试 (${errorFilesCount})` : "批量重试";

  return (
    <div
      style={{
        marginTop: 16,
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        gap: 8,
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          onClick={triggerFileInput}
          disabled={isNetworkOffline}
          title={isNetworkOffline ? "网络已断开，无法选择文件" : ""}
        >
          选择文件
        </Button>
        <Button
          type="primary"
          onClick={uploadAll}
          disabled={
            allFilesCount === 0 ||
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
          onClick={clearList}
          disabled={allFilesCount === 0 || isUploading || isRetryingAll}
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
            onClick={retryAllUpload}
            disabled={
              errorFilesCount === 0 ||
              isUploading ||
              isRetryingAll ||
              isNetworkOffline
            }
            loading={isRetryingAll}
          >
            {isRetryingAll ? "重试中..." : retryButtonTitle}
          </Button>
        </Tooltip>

        {loading && processProgress && (
          <div
            style={{
              marginLeft: 8,
              color: "#1890ff",
              display: "flex",
              alignItems: "center",
              fontSize: "12px",
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
          <span style={{ color: "green", marginLeft: 8, fontSize: "12px" }}>
            操作耗时：{cost} ms
          </span>
        )}
      </div>

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

        <Tooltip title={`${autoUpload ? "开启" : "关闭"}自动上传`}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: "12px",
            }}
          >
            <span style={{ marginRight: 4 }}>自动上传:</span>
            <Switch
              checked={autoUpload}
              onChange={(checked) => setAutoUpload(checked)}
              size="small"
            />
          </div>
        </Tooltip>

        <Tooltip title="存储统计">
          <Button
            type="text"
            icon={<BarChartOutlined />}
            onClick={showStorageStats}
            size="small"
          />
        </Tooltip>
      </div>
    </div>
  );
};

export default FileUploadActions;
