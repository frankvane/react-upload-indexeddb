import { Badge, Button, Space, Tooltip } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import React from "react";
import useBatchDownloader from "../hooks/useBatchDownloader";
import { useDownloadStore } from "../store/download";

/**
 * 下载操作组件
 *
 * 提供下载相关的操作按钮，如开始下载、暂停、继续、取消等
 */
const DownloadActions: React.FC = () => {
  const {
    isDownloading,
    activeDownloads,
    pausedDownloads,
    failedDownloads,
    isNetworkOffline,
  } = useDownloadStore();

  const {
    downloadAll,
    pauseAllDownloads,
    resumeAllDownloads,
    cancelAllDownloads,
    retryAllFailedDownloads,
  } = useBatchDownloader();

  return (
    <div className="download-actions">
      <Space size="middle">
        <Tooltip
          title={isNetworkOffline ? "网络已断开，无法开始下载" : "开始下载"}
        >
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            onClick={downloadAll}
            disabled={isNetworkOffline || isDownloading}
          >
            开始下载
          </Button>
        </Tooltip>

        <Tooltip title="暂停所有下载">
          <Button
            icon={<PauseOutlined />}
            onClick={pauseAllDownloads}
            disabled={activeDownloads === 0}
          >
            暂停
            {activeDownloads > 0 && (
              <Badge count={activeDownloads} size="small" offset={[5, -5]} />
            )}
          </Button>
        </Tooltip>

        <Tooltip
          title={isNetworkOffline ? "网络已断开，无法继续下载" : "继续下载"}
        >
          <Button
            icon={<PlayCircleOutlined />}
            onClick={resumeAllDownloads}
            disabled={isNetworkOffline || pausedDownloads === 0}
          >
            继续
            {pausedDownloads > 0 && (
              <Badge count={pausedDownloads} size="small" offset={[5, -5]} />
            )}
          </Button>
        </Tooltip>

        <Tooltip title="取消所有下载">
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={cancelAllDownloads}
            disabled={activeDownloads === 0 && pausedDownloads === 0}
          >
            取消
          </Button>
        </Tooltip>

        <Tooltip title="重试失败的下载">
          <Button
            icon={<ReloadOutlined />}
            onClick={retryAllFailedDownloads}
            disabled={failedDownloads === 0 || isNetworkOffline}
          >
            重试
            {failedDownloads > 0 && (
              <Badge count={failedDownloads} size="small" offset={[5, -5]} />
            )}
          </Button>
        </Tooltip>
      </Space>

      <NetworkStatusBadge />
    </div>
  );
};

/**
 * 网络状态标识组件
 */
export const NetworkStatusBadge: React.FC = () => {
  const { isNetworkOffline, networkType } = useDownloadStore();

  // 根据网络类型获取对应的状态文本和颜色
  const getNetworkStatusInfo = () => {
    if (isNetworkOffline) {
      return { text: "离线", color: "red" };
    }

    switch (networkType) {
      case "ethernet":
        return { text: "有线网络", color: "green" };
      case "wifi":
        return { text: "WiFi", color: "green" };
      case "cellular":
        return { text: "移动网络", color: "orange" };
      case "2g":
        return { text: "2G", color: "red" };
      case "3g":
        return { text: "3G", color: "orange" };
      case "4g":
        return { text: "4G", color: "green" };
      case "5g":
        return { text: "5G", color: "green" };
      default:
        return { text: "未知", color: "gray" };
    }
  };

  const { text, color } = getNetworkStatusInfo();

  return (
    <div className="network-status">
      <Badge
        status={
          color as "success" | "processing" | "default" | "error" | "warning"
        }
        text={text}
      />
    </div>
  );
};

/**
 * 进度显示组件
 */
export const ProgressDisplay: React.FC = () => {
  const { totalProgress } = useDownloadStore();

  return (
    <div className="progress-display">
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${totalProgress}%` }}
        ></div>
      </div>
      <div className="progress-text">{totalProgress.toFixed(1)}%</div>
    </div>
  );
};

export default DownloadActions;
