import { Badge, Button, Tooltip } from "antd";
import { DisconnectOutlined, WifiOutlined } from "@ant-design/icons";

import React from "react";

interface NetworkStatusBadgeProps {
  networkType: string;
  chunkSize: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  isOffline: boolean;
}

const getNetworkStatusColor = (networkType: string) => {
  if (networkType === "offline") return "#f5222d";
  if (networkType === "slow-2g" || networkType === "2g") return "#fa8c16";
  if (networkType === "3g") return "#faad14";
  if (
    networkType === "4g" ||
    networkType === "wifi" ||
    networkType === "ethernet"
  )
    return "#52c41a";
  return "#1677ff";
};

const getNetworkTypeDisplay = (networkType: string) => {
  if (networkType === "offline") return "离线";
  if (networkType === "wifi") return "WiFi";
  if (networkType === "ethernet") return "有线网络";
  return networkType.toUpperCase();
};

const NetworkStatusBadge: React.FC<NetworkStatusBadgeProps> = ({
  networkType,
  chunkSize,
  fileConcurrency,
  chunkConcurrency,
  isOffline,
}) => (
  <Tooltip
    title={
      `网络状态: ${getNetworkTypeDisplay(networkType)}\n` +
      (!isOffline
        ? `切片大小: ${(chunkSize / (1024 * 1024)).toFixed(
            1
          )}MB\n文件并发: ${fileConcurrency}\n分片并发: ${chunkConcurrency}`
        : "网络已断开，无法上传文件")
    }
  >
    <Badge
      count={
        isOffline ? (
          <DisconnectOutlined style={{ color: "#f5222d" }} />
        ) : (
          <WifiOutlined style={{ color: getNetworkStatusColor(networkType) }} />
        )
      }
      size="small"
    >
      <Button
        type={isOffline ? "default" : "text"}
        danger={isOffline}
        style={{ position: "relative", zIndex: 2 }}
      >
        {getNetworkTypeDisplay(networkType)}
      </Button>
    </Badge>
  </Tooltip>
);

export default NetworkStatusBadge;
