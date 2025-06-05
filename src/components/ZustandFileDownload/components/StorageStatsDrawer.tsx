import {
  Button,
  Divider,
  Drawer,
  List,
  Progress,
  Space,
  Statistic,
  Typography,
} from "antd";
import {
  DatabaseOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import React, { useEffect, useState } from "react";

import { StorageUsage } from "../types/download";
import { useDownloadStore } from "../store/download";

const { Title, Text } = Typography;

/**
 * 存储统计抽屉组件
 *
 * 显示存储统计信息，包括已用空间、可用空间等
 */
const StorageStatsDrawer: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [loading, setLoading] = useState(false);

  const { getStorageUsage, cleanupStorage } = useDownloadStore();

  // 加载存储使用情况
  const loadStorageUsage = async () => {
    setLoading(true);
    try {
      const usage = await getStorageUsage();
      setStorageUsage(usage);
    } catch (error) {
      console.error("Failed to load storage usage:", error);
    } finally {
      setLoading(false);
    }
  };

  // 清理存储
  const handleCleanup = async () => {
    setLoading(true);
    try {
      await cleanupStorage();
      await loadStorageUsage();
    } catch (error) {
      console.error("Failed to cleanup storage:", error);
    } finally {
      setLoading(false);
    }
  };

  // 打开抽屉时加载存储使用情况
  useEffect(() => {
    if (visible) {
      loadStorageUsage();
    }
  }, [visible]);

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <>
      <Button
        type="dashed"
        icon={<DatabaseOutlined />}
        onClick={() => setVisible(true)}
        style={{ marginTop: 16 }}
      >
        存储统计
      </Button>
      <Drawer
        title="存储使用统计"
        placement="right"
        onClose={() => setVisible(false)}
        open={visible}
        width={500}
        extra={
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={loadStorageUsage}
              loading={loading}
            >
              刷新
            </Button>
            <Button
              type="primary"
              danger
              icon={<DeleteOutlined />}
              onClick={handleCleanup}
              loading={loading}
            >
              清理存储
            </Button>
          </Space>
        }
      >
        {storageUsage ? (
          <div className="storage-stats">
            <Title level={4}>存储概览</Title>
            <Progress
              percent={Math.round(storageUsage.usagePercentage)}
              status={
                storageUsage.usagePercentage > 90 ? "exception" : "normal"
              }
              format={(percent) => `${percent}%`}
            />

            <div className="storage-details" style={{ marginTop: 24 }}>
              <Space size="large">
                <Statistic
                  title="总配额"
                  value={formatSize(storageUsage.quota)}
                  valueStyle={{ fontSize: "16px" }}
                />
                <Statistic
                  title="已使用"
                  value={formatSize(
                    storageUsage.indexedDBUsage + storageUsage.fileSystemUsage
                  )}
                  valueStyle={{ fontSize: "16px" }}
                />
                <Statistic
                  title="可用空间"
                  value={formatSize(storageUsage.availableSpace)}
                  valueStyle={{ fontSize: "16px" }}
                />
              </Space>
            </div>

            <Divider />

            <Title level={4}>存储明细</Title>
            <Space size="large" style={{ marginBottom: 16 }}>
              <Statistic
                title="IndexedDB 使用"
                value={formatSize(storageUsage.indexedDBUsage)}
                valueStyle={{ fontSize: "16px" }}
              />
              <Statistic
                title="FileSystem 使用"
                value={formatSize(storageUsage.fileSystemUsage)}
                valueStyle={{ fontSize: "16px" }}
              />
            </Space>

            <Divider />

            <Title level={4}>文件占用</Title>
            {storageUsage.tasks.length > 0 ? (
              <List
                dataSource={storageUsage.tasks}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={item.fileName}
                      description={`大小: ${formatSize(item.size)}`}
                    />
                  </List.Item>
                )}
              />
            ) : (
              <Text type="secondary">没有文件占用存储空间</Text>
            )}
          </div>
        ) : (
          <div className="storage-stats-loading">
            <Text type="secondary">加载存储统计信息...</Text>
          </div>
        )}
      </Drawer>
    </>
  );
};

export default StorageStatsDrawer;
