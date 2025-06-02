import { Progress } from "antd";
import React from "react";

// Ant Design Progress 组件支持的状态类型
type AntProgressStatus = "success" | "exception" | "normal" | "active";

// 我们自定义的状态类型
export type PercentDisplayStatus = "normal" | "success" | "error" | "active";

// 状态类型映射
const statusMap: Record<PercentDisplayStatus, AntProgressStatus | undefined> = {
  normal: "normal",
  success: "success",
  error: "exception",
  active: "active",
};

interface PercentDisplayProps {
  percent: number;
  status?: PercentDisplayStatus;
  showInfo?: boolean;
  size?: "default" | "small";
  width?: number | string;
}

const PercentDisplay: React.FC<PercentDisplayProps> = ({
  percent,
  status = "normal",
  showInfo = true,
  size = "small",
  width,
}) => {
  // 确保百分比在0-100范围内
  const safePercent = Math.min(100, Math.max(0, percent || 0));

  // 将我们的状态类型映射到 Ant Design 的状态类型
  const antStatus = statusMap[status];

  return (
    <div style={{ width: width || "100%" }}>
      <Progress
        percent={safePercent}
        status={antStatus}
        showInfo={showInfo}
        size={size}
      />
    </div>
  );
};

export default PercentDisplay;
