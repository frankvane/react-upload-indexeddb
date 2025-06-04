import { Progress } from "antd";
import React from "react";

interface PercentDisplayProps {
  percent: number;
  status?: "normal" | "active" | "success" | "exception" | "error";
}

const PercentDisplay: React.FC<PercentDisplayProps> = ({
  percent,
  status = "normal",
}) => {
  // 将status转换为Progress组件可接受的类型
  const progressStatus = status === "error" ? "exception" : status;

  return (
    <Progress
      percent={percent}
      status={
        progressStatus as
          | "success"
          | "exception"
          | "normal"
          | "active"
          | undefined
      }
      size="small"
      format={(percent) => `${Math.floor(percent || 0)}%`}
    />
  );
};

export default PercentDisplay;
