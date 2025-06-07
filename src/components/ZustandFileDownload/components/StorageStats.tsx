import { Button, Card, Modal, Space, Spin } from "antd";
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import React, { useMemo } from "react";

import { Typography } from "antd";
import { formatFileSize } from "../utils";
import { useStorageManager } from "../hooks/useStorageManager";

const { Text } = Typography;

export const StorageStats: React.FC = React.memo(() => {
  const { storageUsage, getStorageUsage, clearAllData } = useStorageManager();

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

  const handleRefresh = () => {
    getStorageUsage(true);
  };

  return (
    <Card style={{ marginBottom: "20px" }}>
      <div
        style={{ display: "flex", alignItems: "center", flexWrap: "nowrap" }}
      >
        <div style={{ marginRight: "8px", whiteSpace: "nowrap" }}>
          <Text strong>存储使用情况:</Text>
          {storageUsage.isLoading && (
            <Spin size="small" style={{ marginLeft: 4 }} />
          )}
        </div>

        <div style={{ flex: "1", display: "flex", alignItems: "center" }}>
          <Text strong>{displayUsage}</Text>
          <Text type="secondary" style={{ margin: "0 4px" }}>
            / {formatFileSize(storageUsage.quota)}
          </Text>
          <Text type={textType}>（{displayPercent}%）</Text>
        </div>

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
