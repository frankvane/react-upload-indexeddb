import {
  Badge,
  Button,
  Col,
  Divider,
  InputNumber,
  Modal,
  Row,
  Slider,
  Space,
  Tooltip,
  Typography,
  message,
} from "antd";
import React, { useRef, useState } from "react";
import { SettingOutlined, SwapOutlined } from "@ant-design/icons";

import { formatFileSize } from "../utils";
import { useDownloadStore } from "../store";

const { Text } = Typography;

// Badge状态类型
type BadgeStatusType =
  | "success"
  | "processing"
  | "default"
  | "error"
  | "warning";

interface NetworkStatusBadgeProps {
  networkType: string;
  chunkSize: number;
  fileConcurrency: number;
  chunkConcurrency: number;
  isOffline: boolean;
  displayMode: "tooltip" | "direct";
}

// 创建一个包装Badge的组件
const BadgeWrapper = React.forwardRef<
  HTMLSpanElement,
  { status: BadgeStatusType; text: string }
>((props, ref) => {
  return (
    <span ref={ref}>
      <Badge status={props.status} text={props.text} />
    </span>
  );
});

BadgeWrapper.displayName = "BadgeWrapper";

export const NetworkStatusBadge: React.FC<NetworkStatusBadgeProps> = ({
  networkType,
  chunkSize,
  fileConcurrency,
  chunkConcurrency,
  isOffline,
  displayMode = "tooltip",
}) => {
  const { updateNetworkStatus } = useDownloadStore();

  // 添加内部状态来控制显示模式
  const [currentDisplayMode, setCurrentDisplayMode] = useState<
    "tooltip" | "direct"
  >(displayMode);

  // 网络参数设置相关状态
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [localChunkSize, setLocalChunkSize] = useState(chunkSize);
  const [localFileConcurrency, setLocalFileConcurrency] =
    useState(fileConcurrency);
  const [localChunkConcurrency, setLocalChunkConcurrency] =
    useState(chunkConcurrency);

  // 创建一个引用
  const badgeRef = useRef<HTMLSpanElement>(null);

  // 切换显示模式
  const toggleDisplayMode = () => {
    setCurrentDisplayMode((prev) =>
      prev === "tooltip" ? "direct" : "tooltip"
    );
  };

  // 打开设置对话框
  const showSettings = () => {
    // 初始化本地状态为当前值
    setLocalChunkSize(chunkSize);
    setLocalFileConcurrency(fileConcurrency);
    setLocalChunkConcurrency(chunkConcurrency);
    setIsSettingsVisible(true);
  };

  // 关闭设置对话框
  const hideSettings = () => {
    setIsSettingsVisible(false);
  };

  // 应用设置
  const applySettings = () => {
    updateNetworkStatus({
      chunkSize: localChunkSize,
      fileConcurrency: localFileConcurrency,
      chunkConcurrency: localChunkConcurrency,
    });

    // 显示成功消息
    message.success(
      `已应用网络设置：分片大小 ${formatFileSize(
        localChunkSize
      )}，文件并发 ${localFileConcurrency}，分片并发 ${localChunkConcurrency}`
    );

    hideSettings();
  };

  // 重置设置
  const resetSettings = () => {
    setLocalChunkSize(1024 * 1024); // 1MB
    setLocalFileConcurrency(3);
    setLocalChunkConcurrency(3);
  };

  // 将KB转换为B，用于分片大小的滑块显示
  const chunkSizeKB = Math.round(localChunkSize / 1024);

  // 网络类型对应的颜色和文本
  const getNetworkInfo = () => {
    if (isOffline) {
      return {
        color: "red",
        text: "离线",
        status: "error" as BadgeStatusType,
      };
    }

    switch (networkType) {
      case "4g":
        return {
          color: "green",
          text: "4G",
          status: "success" as BadgeStatusType,
        };
      case "3g":
        return {
          color: "cyan",
          text: "3G",
          status: "processing" as BadgeStatusType,
        };
      case "2g":
        return {
          color: "orange",
          text: "2G",
          status: "warning" as BadgeStatusType,
        };
      case "slow-2g":
        return {
          color: "red",
          text: "慢2G",
          status: "error" as BadgeStatusType,
        };
      case "wifi":
        return {
          color: "green",
          text: "WiFi",
          status: "success" as BadgeStatusType,
        };
      case "ethernet":
        return {
          color: "green",
          text: "有线",
          status: "success" as BadgeStatusType,
        };
      default:
        return {
          color: "blue",
          text: networkType || "未知",
          status: "default" as BadgeStatusType,
        };
    }
  };

  const networkInfo = getNetworkInfo();

  // 网络参数详情
  const networkDetails = (
    <>
      <div>网络类型: {networkInfo.text}</div>
      <div>分片大小: {formatFileSize(chunkSize)}</div>
      <div>文件并发: {fileConcurrency}</div>
      <div>分片并发: {chunkConcurrency}</div>
    </>
  );

  // 根据当前显示模式决定如何展示
  const renderContent = () => {
    if (currentDisplayMode === "direct") {
      return (
        <div
          style={{ display: "flex", alignItems: "center", fontSize: "12px" }}
        >
          <Badge status={networkInfo.status} text={networkInfo.text} />
          <span style={{ marginLeft: 8 }}>
            {formatFileSize(chunkSize)} | {fileConcurrency}文件 |{" "}
            {chunkConcurrency}
            分片
          </span>
        </div>
      );
    }

    return (
      <Tooltip
        title={networkDetails}
        placement="bottom"
        getPopupContainer={() => document.body}
      >
        <BadgeWrapper
          ref={badgeRef}
          status={networkInfo.status}
          text={networkInfo.text}
        />
      </Tooltip>
    );
  };

  return (
    <>
      <Space align="center">
        {renderContent()}
        <Button
          type="link"
          icon={<SwapOutlined />}
          size="small"
          onClick={toggleDisplayMode}
          title={`切换到${
            currentDisplayMode === "tooltip" ? "详细" : "简洁"
          }模式`}
        />
        <Button
          type="link"
          icon={<SettingOutlined />}
          size="small"
          onClick={showSettings}
          title="网络参数设置"
        />
      </Space>

      <Modal
        title="网络参数设置"
        open={isSettingsVisible}
        onCancel={hideSettings}
        onOk={applySettings}
        width={600}
        footer={[
          <Button key="reset" onClick={resetSettings}>
            重置
          </Button>,
          <Button key="cancel" onClick={hideSettings}>
            取消
          </Button>,
          <Button key="apply" type="primary" onClick={applySettings}>
            应用
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <Text strong>分片大小: {formatFileSize(localChunkSize)}</Text>
            <Row gutter={16}>
              <Col span={16}>
                <Slider
                  min={128}
                  max={5120}
                  step={128}
                  value={chunkSizeKB}
                  onChange={(value) => setLocalChunkSize(value * 1024)}
                  marks={{
                    128: "128KB",
                    1024: "1MB",
                    2048: "2MB",
                    5120: "5MB",
                  }}
                />
              </Col>
              <Col span={8}>
                <InputNumber
                  min={128}
                  max={5120}
                  value={chunkSizeKB}
                  onChange={(value) => value && setLocalChunkSize(value * 1024)}
                  addonAfter="KB"
                  style={{ width: "100%" }}
                />
              </Col>
            </Row>
          </div>

          <Divider style={{ margin: "12px 0" }} />

          <div>
            <Text strong>文件并发数: {localFileConcurrency}</Text>
            <Row gutter={16}>
              <Col span={16}>
                <Slider
                  min={1}
                  max={10}
                  value={localFileConcurrency}
                  onChange={setLocalFileConcurrency}
                  marks={{
                    1: "1",
                    3: "3",
                    5: "5",
                    10: "10",
                  }}
                />
              </Col>
              <Col span={8}>
                <InputNumber
                  min={1}
                  max={10}
                  value={localFileConcurrency}
                  onChange={(value) => value && setLocalFileConcurrency(value)}
                  style={{ width: "100%" }}
                />
              </Col>
            </Row>
          </div>

          <Divider style={{ margin: "12px 0" }} />

          <div>
            <Text strong>分片并发数: {localChunkConcurrency}</Text>
            <Row gutter={16}>
              <Col span={16}>
                <Slider
                  min={1}
                  max={10}
                  value={localChunkConcurrency}
                  onChange={setLocalChunkConcurrency}
                  marks={{
                    1: "1",
                    3: "3",
                    5: "5",
                    10: "10",
                  }}
                />
              </Col>
              <Col span={8}>
                <InputNumber
                  min={1}
                  max={10}
                  value={localChunkConcurrency}
                  onChange={(value) => value && setLocalChunkConcurrency(value)}
                  style={{ width: "100%" }}
                />
              </Col>
            </Row>
          </div>
        </Space>
      </Modal>
    </>
  );
};
