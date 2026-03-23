import { Button, Card, Modal, Space, Spin, Typography } from "antd";
import { DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import React, { useMemo } from "react";

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
      title: "清空本地数据？",
      content:
        "将删除浏览器存储中的下载文件与进度记录，此操作不可撤销。",
      okText: "清空",
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
      <div style={{ display: "flex", alignItems: "center", flexWrap: "nowrap" }}>
        <div style={{ marginRight: "8px", whiteSpace: "nowrap" }}>
          <Text strong>存储使用:</Text>
          {storageUsage.isLoading && (
            <Spin size="small" style={{ marginLeft: 4 }} />
          )}
        </div>

        <div style={{ flex: "1", display: "flex", alignItems: "center" }}>
          <Text strong>{displayUsage}</Text>
          <Text type="secondary" style={{ margin: "0 4px" }}>
            / {formatFileSize(storageUsage.quota)}
          </Text>
          <Text type={textType}>({displayPercent}%)</Text>
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
