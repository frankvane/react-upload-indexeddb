import { Button, Card, Modal, Progress, Space, Spin, Tooltip } from "antd";
import {
  DeleteOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";

import React from "react";
import { StorageUsage } from "../types";
import { Typography } from "antd";
import { formatFileSize } from "../utils";

const { Text } = Typography;

interface StorageStatsProps {
  storageUsage: StorageUsage;
  getStorageUsage: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

/**
 * 存储统计组件
 */
export const StorageStats: React.FC<StorageStatsProps> = ({
  storageUsage,
  getStorageUsage,
  clearAllData,
}) => {
  // 计算进度条状态
  const getProgressStatus = () => {
    if (storageUsage.isLoading) return "active";
    if (storageUsage.percent > 90) return "exception"; // 超过90%显示红色
    return "normal"; // 其他情况显示正常颜色
  };

  // 格式化上次更新时间
  const formatLastUpdated = () => {
    if (!storageUsage.lastUpdated) return "未更新";

    const now = new Date();
    const lastUpdate = new Date(storageUsage.lastUpdated);
    const diffSeconds = Math.floor(
      (now.getTime() - lastUpdate.getTime()) / 1000
    );

    if (diffSeconds < 60) return `${diffSeconds}秒前`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}分钟前`;
    return lastUpdate.toLocaleTimeString();
  };

  // 处理清空数据按钮点击
  const handleClearData = () => {
    Modal.confirm({
      title: "确认清空所有数据",
      content: "此操作将清空所有下载的文件和进度信息，无法恢复。确定要继续吗？",
      okText: "确认清空",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        await clearAllData();
      },
    });
  };

  return (
    <Card
      title={
        <Space>
          <span>存储使用情况</span>
          {storageUsage.isLoading && <Spin size="small" />}
        </Space>
      }
      style={{ marginBottom: "20px" }}
      extra={
        <Space>
          {storageUsage.lastUpdated > 0 && (
            <Tooltip
              title={`上次更新: ${new Date(
                storageUsage.lastUpdated
              ).toLocaleString()}`}
            >
              <Text type="secondary">更新于: {formatLastUpdated()}</Text>
            </Tooltip>
          )}
          <Button
            size="small"
            onClick={getStorageUsage}
            icon={<ReloadOutlined />}
            loading={storageUsage.isLoading}
          >
            刷新
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Space align="center">
          <Text>已使用:</Text>
          <Text strong>
            {formatFileSize(storageUsage.estimatedUsage || storageUsage.usage)}
          </Text>
          <Text>/</Text>
          <Text>{formatFileSize(storageUsage.quota)}</Text>
          <Text
            type={
              storageUsage.percent > 90
                ? "danger"
                : storageUsage.percent > 70
                ? "warning"
                : "secondary"
            }
          >
            （
            {(storageUsage.estimatedUsage
              ? (storageUsage.estimatedUsage / storageUsage.quota) * 100
              : storageUsage.percent
            ).toFixed(2)}
            %）
          </Text>
          {storageUsage.estimatedUsage !== storageUsage.usage && (
            <Tooltip title="估计值与实际值可能存在差异，点击刷新按钮获取准确数据">
              <InfoCircleOutlined style={{ color: "#1890ff" }} />
            </Tooltip>
          )}
        </Space>

        {storageUsage.estimatedUsage !== storageUsage.usage && (
          <Text type="secondary" style={{ fontSize: "12px" }}>
            实际值: {formatFileSize(storageUsage.usage)}
            （估计值可能包含最近的更改）
          </Text>
        )}

        <Progress
          percent={parseFloat(
            (storageUsage.estimatedUsage
              ? (storageUsage.estimatedUsage / storageUsage.quota) * 100
              : storageUsage.percent
            ).toFixed(1)
          )}
          status={getProgressStatus()}
          size={10}
        />
      </Space>
      <div style={{ marginTop: "16px" }}>
        <Button
          danger
          onClick={handleClearData}
          icon={<DeleteOutlined />}
          disabled={storageUsage.isLoading}
        >
          清空所有数据
        </Button>
      </div>
    </Card>
  );
};
