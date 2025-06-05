import { Button, Switch, Tooltip } from "antd";
import { NetworkStatusBadge, ProcessProgressDisplay } from "./";

import { BarChartOutlined } from "@ant-design/icons";
import React from "react";
import { useUploadStore } from "../store/upload";

interface FileUploadActionsProps {
  triggerFileInput: () => void;
}

const FileUploadActions: React.FC<FileUploadActionsProps> = ({
  triggerFileInput,
}) => {
  const {
    files,
    isUploading,
    isRetryingAll,
    isNetworkOffline,
    autoUpload,
    setAutoUpload,
    networkDisplayMode,
    setNetworkDisplayMode,
    networkType,
    chunkSize,
    fileConcurrency,
    chunkConcurrency,
    uploadAll,
    handleClearList,
    handleRetryAllUpload,
    setStorageStatsVisible,
    loading,
    cost,
    processProgress,
  } = useUploadStore();

  // 计算错误文件数量
  const errorFilesCount = files.filter(
    (file) => file.status === "error"
  ).length;

  // 按钮标题
  const retryButtonTitle =
    errorFilesCount > 0 ? `批量重试 (${errorFilesCount})` : "批量重试";

  // 打开存储统计抽屉
  const showStorageStats = () => {
    setStorageStatsVisible(true);
  };

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
            files.length === 0 ||
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
          disabled={files.length === 0 || isUploading || isRetryingAll}
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

        {/* 显示文件处理进度 */}
        {(loading || processProgress || cost !== null) && (
          <ProcessProgressDisplay
            loading={loading}
            processProgress={processProgress}
            cost={cost}
          />
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
