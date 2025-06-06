import { Button, Card, Modal, Space, Spin } from "antd";
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import React, { useMemo } from "react";

import { Typography } from "antd";
import { formatFileSize } from "../utils";
import { useStorageManager } from "../hooks/useStorageManager";

const { Text } = Typography;

/**
 * 存储统计组件 - 单行紧凑版
 */
export const StorageStats: React.FC = React.memo(() => {
  // 直接从hooks获取状态和方法
  const { storageUsage, getStorageUsage, clearAllData } = useStorageManager();

  // 计算显示的使用量和百分比
  const { displayUsage, displayPercent, textType } = useMemo(() => {
    const usage = storageUsage.usage;
    const percent = storageUsage.percent;

    const type =
      percent > 90 ? "danger" : percent > 70 ? "warning" : "secondary";

    return {
      displayUsage: formatFileSize(usage),
      displayPercent: percent.toFixed(2),
      textType: type as "danger" | "warning" | "secondary",
    };
  }, [storageUsage.usage, storageUsage.percent]);

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

  return (
    <Card style={{ marginBottom: "20px" }}>
      <div
        style={{ display: "flex", alignItems: "center", flexWrap: "nowrap" }}
      >
        {/* 标题和状态 */}
        <div style={{ marginRight: "8px", whiteSpace: "nowrap" }}>
          <Text strong>存储使用情况:</Text>
          {storageUsage.isLoading && (
            <Spin size="small" style={{ marginLeft: 4 }} />
          )}
        </div>

        {/* 使用量信息 */}
        <div style={{ flex: "1", display: "flex", alignItems: "center" }}>
          <Text strong>{displayUsage}</Text>
          <Text type="secondary" style={{ margin: "0 4px" }}>
            / {formatFileSize(storageUsage.quota)}
          </Text>
          <Text type={textType}>（{displayPercent}%）</Text>
        </div>

        {/* 按钮组 */}
        <Space size="small">
          <Button
            size="small"
            onClick={handleRefresh}
            icon={<ReloadOutlined />}
            loading={storageUsage.isLoading}
            style={{ padding: "0 8px" }}
          >
            刷新
          </Button>

          <Button
            danger
            size="small"
            onClick={handleClearData}
            icon={<DeleteOutlined />}
            disabled={storageUsage.isLoading}
            style={{ padding: "0 8px" }}
          >
            清空
          </Button>
        </Space>
      </div>
    </Card>
  );
});
