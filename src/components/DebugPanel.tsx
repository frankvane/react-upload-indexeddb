import { Badge, Button, Card, Collapse, Space, Tag, Typography } from "antd";
import {
  BugOutlined,
  CheckCircleOutlined,
  ClearOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";

const { Text, Paragraph } = Typography;

interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  category: "upload" | "download" | "network" | "storage" | "system";
  message: string;
  data?: any;
}

interface DebugPanelProps {
  logs: LogEntry[];
  onClearLogs: () => void;
}

const DebugPanel: React.FC<DebugPanelProps> = ({ logs, onClearLogs }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    info: 0,
    success: 0,
    warning: 0,
    error: 0,
  });

  useEffect(() => {
    const newStats = logs.reduce(
      (acc, log) => {
        acc.total++;
        acc[log.level]++;
        return acc;
      },
      { total: 0, info: 0, success: 0, warning: 0, error: 0 }
    );

    setStats(newStats);
  }, [logs]);

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "info":
        return <InfoCircleOutlined style={{ color: "#1890ff" }} />;
      case "success":
        return <CheckCircleOutlined style={{ color: "#52c41a" }} />;
      case "warning":
        return <WarningOutlined style={{ color: "#faad14" }} />;
      case "error":
        return <CloseCircleOutlined style={{ color: "#ff4d4f" }} />;
      default:
        return <InfoCircleOutlined />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "upload":
        return "blue";
      case "download":
        return "green";
      case "network":
        return "orange";
      case "storage":
        return "purple";
      case "system":
        return "gray";
      default:
        return "default";
    }
  };

  const exportLogs = () => {
    const dataStr = JSON.stringify(logs, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `debug-logs-${new Date().toISOString().slice(0, 19)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card
      title={
        <Space>
          <BugOutlined />
          调试面板
          <Badge count={stats.total} style={{ backgroundColor: "#52c41a" }} />
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={exportLogs}
            disabled={logs.length === 0}
          >
            导出日志
          </Button>
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={onClearLogs}
            disabled={logs.length === 0}
          >
            清空
          </Button>
          <Button
            size="small"
            type={isVisible ? "primary" : "default"}
            onClick={() => setIsVisible(!isVisible)}
          >
            {isVisible ? "隐藏" : "显示"}
          </Button>
        </Space>
      }
      style={{ marginBottom: 16 }}
    >
      {/* 统计信息 */}
      <Space wrap style={{ marginBottom: 16 }}>
        <Tag color="default">总计: {stats.total}</Tag>
        <Tag color="blue">信息: {stats.info}</Tag>
        <Tag color="green">成功: {stats.success}</Tag>
        <Tag color="orange">警告: {stats.warning}</Tag>
        <Tag color="red">错误: {stats.error}</Tag>
      </Space>

      {isVisible && (
        <Collapse
          size="small"
          ghost
          items={[
            {
              key: "logs",
              label: "日志详情",
              children: (
                <div style={{ maxHeight: 400, overflowY: "auto" }}>
                  {logs.length === 0 ? (
                    <Text type="secondary">暂无日志记录</Text>
                  ) : (
                    logs
                      .slice()
                      .reverse()
                      .map((log) => (
                        <div
                          key={log.id}
                          style={{
                            padding: "8px 0",
                            borderBottom: "1px solid #f0f0f0",
                            fontSize: "12px",
                          }}
                        >
                          <Space size="small" wrap>
                            {getLevelIcon(log.level)}
                            <Tag color={getCategoryColor(log.category)}>
                              {log.category}
                            </Tag>
                            <Text type="secondary" style={{ fontSize: "11px" }}>
                              {log.timestamp}
                            </Text>
                          </Space>
                          <Paragraph
                            style={{
                              margin: "4px 0 0 0",
                              fontSize: "12px",
                              lineHeight: "1.4",
                            }}
                          >
                            {log.message}
                          </Paragraph>
                          {log.data && (
                            <details style={{ marginTop: 4 }}>
                              <summary
                                style={{
                                  cursor: "pointer",
                                  fontSize: "11px",
                                  color: "#666",
                                }}
                              >
                                查看详细数据
                              </summary>
                              <pre
                                style={{
                                  fontSize: "10px",
                                  background: "#f5f5f5",
                                  padding: "4px",
                                  margin: "4px 0 0 0",
                                  borderRadius: "2px",
                                  overflow: "auto",
                                  maxHeight: "100px",
                                }}
                              >
                                {JSON.stringify(log.data, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))
                  )}
                </div>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
};

export default DebugPanel;
