import { Button, Card, Modal, Progress, Space, Spin, Tooltip } from "antd";
import {
  DeleteOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import React, { useMemo } from "react";

import { Typography } from "antd";
import { formatFileSize } from "../utils";
import { useStorageManager } from "../hooks/useStorageManager";

const { Text } = Typography;

/**
 * 存储统计组件
 */
export const StorageStats: React.FC = React.memo(() => {
  // 直接从hooks获取状态和方法
  const { storageUsage, getStorageUsage, clearAllData } = useStorageManager();

  // 计算进度条状态
  const progressStatus = useMemo(() => {
    if (storageUsage.isLoading) return "active";
    if (storageUsage.percent > 90) return "exception"; // 超过90%显示红色
    return "normal"; // 其他情况显示正常颜色
  }, [storageUsage.isLoading, storageUsage.percent]);

  // 格式化上次更新时间
  const lastUpdatedText = useMemo(() => {
    if (!storageUsage.lastUpdated) return "未更新";

    const now = new Date();
    const lastUpdate = new Date(storageUsage.lastUpdated);
    const diffSeconds = Math.floor(
      (now.getTime() - lastUpdate.getTime()) / 1000
    );

    if (diffSeconds < 60) return `${diffSeconds}秒前`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}分钟前`;
    return lastUpdate.toLocaleTimeString();
  }, [storageUsage.lastUpdated]);

  // 计算显示的使用量和百分比
  const { displayUsage, displayPercent, textType } = useMemo(() => {
    const usage = storageUsage.estimatedUsage || storageUsage.usage;
    const percent = storageUsage.estimatedUsage
      ? (storageUsage.estimatedUsage / storageUsage.quota) * 100
      : storageUsage.percent;

    const type =
      percent > 90 ? "danger" : percent > 70 ? "warning" : "secondary";

    return {
      displayUsage: formatFileSize(usage),
      displayPercent: percent.toFixed(2),
      textType: type as "danger" | "warning" | "secondary",
    };
  }, [
    storageUsage.estimatedUsage,
    storageUsage.usage,
    storageUsage.quota,
    storageUsage.percent,
  ]);

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

  // 强制更新存储使用情况
  const handleRefresh = () => {
    getStorageUsage(true); // 传入true表示强制更新
  };

  // 计算是否显示估计值提示
  const showEstimateInfo = useMemo(() => {
    return (
      storageUsage.estimatedUsage !== undefined &&
      storageUsage.estimatedUsage !== storageUsage.usage &&
      storageUsage.usage > 0
    );
  }, [storageUsage.estimatedUsage, storageUsage.usage]);

  // 计算进度条百分比值
  const progressPercent = useMemo(() => {
    const percent = storageUsage.estimatedUsage
      ? (storageUsage.estimatedUsage / storageUsage.quota) * 100
      : storageUsage.percent;
    return parseFloat(percent.toFixed(1));
  }, [storageUsage.estimatedUsage, storageUsage.quota, storageUsage.percent]);

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
              <Text type="secondary">更新于: {lastUpdatedText}</Text>
            </Tooltip>
          )}
          <Button
            size="small"
            onClick={handleRefresh}
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
          <Text strong>{displayUsage}</Text>
          <Text>/</Text>
          <Text>{formatFileSize(storageUsage.quota)}</Text>
          <Text type={textType}>（{displayPercent}%）</Text>
          {showEstimateInfo && (
            <Tooltip title="估计值与实际值可能存在差异，点击刷新按钮获取准确数据">
              <InfoCircleOutlined style={{ color: "#1890ff" }} />
            </Tooltip>
          )}
        </Space>

        {showEstimateInfo && (
          <Text type="secondary" style={{ fontSize: "12px" }}>
            实际值: {formatFileSize(storageUsage.usage)}
            （估计值可能包含最近的更改）
          </Text>
        )}

        <Progress percent={progressPercent} status={progressStatus} size={10} />
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
});
