import { Button, Card, Col, Drawer, Row, Statistic, message } from "antd";
import React, { useEffect, useState } from "react";

import { getStorageStats } from "../utils";

interface StorageStatsDrawerProps {
  visible: boolean;
  onClose: () => void;
  // 可选的外部加载函数
  onLoad?: () => Promise<void>;
}

/**
 * IndexedDB 存储统计抽屉组件
 * 显示文件存储的详细统计信息
 */
const StorageStatsDrawer: React.FC<StorageStatsDrawerProps> = ({
  visible,
  onClose,
  onLoad,
}) => {
  const [statsLoading, setStatsLoading] = useState(false);
  const [storageStats, setStorageStats] = useState<{
    totalFiles: number;
    totalSize: number;
    formattedSize: string;
    filesWithBuffer: number;
    filesWithoutBuffer: number;
    averageFileSize: number;
    formattedAvgSize: string;
  } | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  // 加载存储统计数据
  const loadStorageStats = async () => {
    setStatsLoading(true);
    try {
      const stats = await getStorageStats();
      setStorageStats(stats);
    } catch (error) {
      console.error("获取存储统计信息失败:", error);
      messageApi.error("获取存储统计信息失败");
    } finally {
      setStatsLoading(false);
    }
  };

  // 处理刷新按钮点击
  const handleRefresh = async () => {
    if (onLoad) {
      // 如果提供了外部加载函数，使用它
      await onLoad();
    } else {
      // 否则使用内部加载函数
      await loadStorageStats();
    }
  };

  // 当抽屉显示时加载数据
  useEffect(() => {
    if (visible) {
      handleRefresh();
    }
  }, [visible]);

  return (
    <>
      {contextHolder}
      <Drawer
        title="IndexedDB 存储统计"
        placement="right"
        onClose={onClose}
        open={visible}
        width={400}
      >
        {statsLoading ? (
          <div style={{ textAlign: "center", padding: "20px" }}>
            加载存储统计信息...
          </div>
        ) : storageStats ? (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={24}>
                <Card>
                  <Statistic
                    title="总存储量"
                    value={storageStats.formattedSize}
                    valueStyle={{ color: "#3f8600" }}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <Statistic title="文件总数" value={storageStats.totalFiles} />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="平均文件大小"
                    value={storageStats.formattedAvgSize}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="含缓存数据文件"
                    value={storageStats.filesWithBuffer}
                    valueStyle={{ color: "#1890ff" }}
                  />
                </Card>
              </Col>
              <Col span={12}>
                <Card>
                  <Statistic
                    title="无缓存数据文件"
                    value={storageStats.filesWithoutBuffer}
                    valueStyle={{ color: "#faad14" }}
                  />
                </Card>
              </Col>
            </Row>
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <Button onClick={handleRefresh} loading={statsLoading}>
                刷新统计
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "20px" }}>
            无法获取存储统计信息
          </div>
        )}
      </Drawer>
    </>
  );
};

export default StorageStatsDrawer;
