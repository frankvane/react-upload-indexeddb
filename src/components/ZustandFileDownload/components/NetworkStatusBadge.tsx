import { Badge, Tooltip } from "antd";
import React, { useRef } from "react";

import { formatFileSize } from "../utils";

// Badge状态类型
type BadgeStatusType =
  | "success"
  | "processing"
  | "default"
  | "error"
  | "warning";

interface NetworkStatusBadgeProps {
  networkType: string;
  chunkSize: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  isOffline: boolean;
  displayMode: "tooltip" | "direct";
}

// 创建一个包装Badge的组件
const BadgeWrapper = React.forwardRef<
  HTMLSpanElement,
  { status: BadgeStatusType; text: string }
>((props, ref) => {
  return (
    <span ref={ref}>
      <Badge status={props.status} text={props.text} />
    </span>
  );
});

BadgeWrapper.displayName = "BadgeWrapper";

export const NetworkStatusBadge: React.FC<NetworkStatusBadgeProps> = ({
  networkType,
  chunkSize,
  fileConcurrency,
  chunkConcurrency,
  isOffline,
  displayMode = "tooltip",
}) => {
  // 创建一个引用
  const badgeRef = useRef<HTMLSpanElement>(null);

  // 网络类型对应的颜色和文本
  const getNetworkInfo = () => {
    if (isOffline) {
      return {
        color: "red",
        text: "离线",
        status: "error" as BadgeStatusType,
      };
    }

    switch (networkType) {
      case "4g":
        return {
          color: "green",
          text: "4G",
          status: "success" as BadgeStatusType,
        };
      case "3g":
        return {
          color: "cyan",
          text: "3G",
          status: "processing" as BadgeStatusType,
        };
      case "2g":
        return {
          color: "orange",
          text: "2G",
          status: "warning" as BadgeStatusType,
        };
      case "slow-2g":
        return {
          color: "red",
          text: "慢2G",
          status: "error" as BadgeStatusType,
        };
      case "wifi":
        return {
          color: "green",
          text: "WiFi",
          status: "success" as BadgeStatusType,
        };
      case "ethernet":
        return {
          color: "green",
          text: "有线",
          status: "success" as BadgeStatusType,
        };
      default:
        return {
          color: "blue",
          text: networkType || "未知",
          status: "default" as BadgeStatusType,
        };
    }
  };

  const networkInfo = getNetworkInfo();

  // 网络参数详情
  const networkDetails = (
    <>
      <div>网络类型: {networkInfo.text}</div>
      <div>分片大小: {formatFileSize(chunkSize)}</div>
      <div>文件并发: {fileConcurrency}</div>
      <div>分片并发: {chunkConcurrency}</div>
    </>
  );

  // 根据显示模式决定如何展示
  if (displayMode === "direct") {
    return (
      <div style={{ display: "flex", alignItems: "center", fontSize: "12px" }}>
        <Badge status={networkInfo.status} text={networkInfo.text} />
        <span style={{ marginLeft: 8 }}>
          {formatFileSize(chunkSize)} | {fileConcurrency}文件 |{" "}
          {chunkConcurrency}
          分片
        </span>
      </div>
    );
  }

  return (
    <>
      <Tooltip
        title={networkDetails}
        placement="bottom"
        getPopupContainer={() => document.body}
      >
        <BadgeWrapper
          ref={badgeRef}
          status={networkInfo.status}
          text={networkInfo.text}
        />
      </Tooltip>
    </>
  );
};
