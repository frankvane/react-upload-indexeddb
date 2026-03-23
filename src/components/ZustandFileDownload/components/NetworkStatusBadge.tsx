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
import {
  LockOutlined,
  SettingOutlined,
  SwapOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { formatFileSize } from "../utils";
import { useDownloadStore } from "../store";
import { useShallow } from "zustand/react/shallow";

const { Text } = Typography;

type BadgeStatusType =
  | "success"
  | "processing"
  | "default"
  | "error"
  | "warning";

interface NetworkStatusBadgeProps {
  isOffline: boolean;
  onRefreshFiles: (forceUpdate?: boolean) => Promise<void>;
}

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

export const NetworkStatusBadge: React.FC<NetworkStatusBadgeProps> = React.memo(
  ({ isOffline, onRefreshFiles }) => {
    const {
      networkType,
      chunkSize,
      fileConcurrency,
      chunkConcurrency,
      isManuallySet,
      displayMode,
      updateNetworkStatus,
      resetManualFlag,
      toggleDisplayMode,
    } = useDownloadStore(
      useShallow((state) => ({
        networkType: state.networkType,
        chunkSize: state.chunkSize,
        fileConcurrency: state.fileConcurrency,
        chunkConcurrency: state.chunkConcurrency,
        isManuallySet: state.isManuallySet,
        displayMode: state.displayMode,
        updateNetworkStatus: state.updateNetworkStatus,
        resetManualFlag: state.resetManualFlag,
        toggleDisplayMode: state.toggleDisplayMode,
      }))
    );

    const [isSettingsVisible, setIsSettingsVisible] = useState(false);
    const [localChunkSize, setLocalChunkSize] = useState(chunkSize);
    const [localFileConcurrency, setLocalFileConcurrency] =
      useState(fileConcurrency);
    const [localChunkConcurrency, setLocalChunkConcurrency] =
      useState(chunkConcurrency);

    const badgeRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
      if (!isSettingsVisible) {
        setLocalChunkSize(chunkSize);
        setLocalFileConcurrency(fileConcurrency);
        setLocalChunkConcurrency(chunkConcurrency);
      }
    }, [chunkSize, fileConcurrency, chunkConcurrency, isSettingsVisible]);

    const handleToggleManualFlag = useCallback(() => {
      if (isManuallySet) {
        resetManualFlag();
        message.info("已关闭手动锁定，网络参数将自动调整。");
      } else {
        updateNetworkStatus({}, true);
        message.info("已启用手动锁定，将忽略自动检测到的网络参数。");
      }
    }, [isManuallySet, resetManualFlag, updateNetworkStatus]);

    const showSettings = useCallback(() => {
      setLocalChunkSize(chunkSize);
      setLocalFileConcurrency(fileConcurrency);
      setLocalChunkConcurrency(chunkConcurrency);
      setIsSettingsVisible(true);
    }, [chunkSize, fileConcurrency, chunkConcurrency]);

    const hideSettings = useCallback(() => {
      setIsSettingsVisible(false);
    }, []);

    const applySettings = useCallback(async () => {
      const chunkSizeChanged = chunkSize !== localChunkSize;

      updateNetworkStatus(
        {
          chunkSize: localChunkSize,
          fileConcurrency: localFileConcurrency,
          chunkConcurrency: localChunkConcurrency,
        },
        true
      );

      message.success(
        `已应用设置：分片 ${formatFileSize(
          localChunkSize
        )}，文件并发 ${localFileConcurrency}，分片并发 ${localChunkConcurrency}`
      );

      if (chunkSizeChanged) {
        await onRefreshFiles(true);
      }

      hideSettings();
    }, [
      chunkSize,
      localChunkSize,
      localFileConcurrency,
      localChunkConcurrency,
      updateNetworkStatus,
      onRefreshFiles,
      hideSettings,
    ]);

    const resetSettings = useCallback(() => {
      setLocalChunkSize(1024 * 1024);
      setLocalFileConcurrency(3);
      setLocalChunkConcurrency(3);
    }, []);

    const chunkSizeKB = Math.round(localChunkSize / 1024);

    const getNetworkInfo = useCallback(() => {
      if (isOffline) {
        return {
          text: "离线",
          status: "error" as BadgeStatusType,
        };
      }

      switch (networkType) {
        case "4g":
          return { text: "4G", status: "success" as BadgeStatusType };
        case "3g":
          return { text: "3G", status: "processing" as BadgeStatusType };
        case "2g":
          return { text: "2G", status: "warning" as BadgeStatusType };
        case "slow-2g":
          return { text: "慢速 2G", status: "error" as BadgeStatusType };
        case "wifi":
          return { text: "WiFi", status: "success" as BadgeStatusType };
        case "ethernet":
          return { text: "有线网络", status: "success" as BadgeStatusType };
        default:
          return {
            text: networkType || "未知",
            status: "default" as BadgeStatusType,
          };
      }
    }, [isOffline, networkType]);

    const networkInfo = getNetworkInfo();

    const renderContent = useCallback(() => {
      const networkDetails = (
        <>
          <div>网络: {networkInfo.text}</div>
          <div>分片大小: {formatFileSize(chunkSize)}</div>
          <div>文件并发: {fileConcurrency}</div>
          <div>分片并发: {chunkConcurrency}</div>
          <div>手动锁定: {isManuallySet ? "是" : "否"}</div>
        </>
      );

      if (displayMode === "direct") {
        return (
          <div style={{ display: "flex", alignItems: "center", fontSize: "12px" }}>
            <Badge status={networkInfo.status} text={networkInfo.text} />
            <span style={{ marginLeft: 8 }}>
              {formatFileSize(chunkSize)} | 文件并发 {fileConcurrency} | 分片并发{" "}
              {chunkConcurrency}
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
    }, [
      displayMode,
      networkInfo,
      chunkSize,
      fileConcurrency,
      chunkConcurrency,
      isManuallySet,
    ]);

    const handleToggleDisplayMode = useCallback(() => {
      toggleDisplayMode();
    }, [toggleDisplayMode]);

    return (
      <>
        <Space align="center">
          {renderContent()}
          <Button
            type="link"
            icon={<SwapOutlined />}
            size="small"
            onClick={handleToggleDisplayMode}
            title={`切换到${displayMode === "tooltip" ? "详细" : "紧凑"}模式`}
          />
          <Button
            type="link"
            icon={isManuallySet ? <LockOutlined /> : <UnlockOutlined />}
            size="small"
            onClick={handleToggleManualFlag}
            title={isManuallySet ? "解除设置锁定" : "锁定设置"}
          />
          <Button
            type="link"
            icon={<SettingOutlined />}
            size="small"
            onClick={showSettings}
            title="网络设置"
          />
        </Space>

        <Modal
          title="网络设置"
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
                    onChange={(value) =>
                      value !== null && setLocalChunkSize(value * 1024)
                    }
                    addonAfter="KB"
                    style={{ width: "100%" }}
                  />
                </Col>
              </Row>
            </div>

            <Divider style={{ margin: "12px 0" }} />

            <div>
              <Text strong>文件并发: {localFileConcurrency}</Text>
              <Row gutter={16}>
                <Col span={16}>
                  <Slider
                    min={1}
                    max={10}
                    value={localFileConcurrency}
                    onChange={setLocalFileConcurrency}
                    marks={{
                      1: "1",
                      2: "2",
                      3: "3",
                      4: "4",
                      5: "5",
                      6: "6",
                      7: "7",
                      8: "8",
                      9: "9",
                      10: "10",
                    }}
                  />
                </Col>
                <Col span={8}>
                  <InputNumber
                    min={1}
                    max={10}
                    value={localFileConcurrency}
                    onChange={(value) =>
                      value !== null && setLocalFileConcurrency(value)
                    }
                    style={{ width: "100%" }}
                  />
                </Col>
              </Row>
            </div>

            <Divider style={{ margin: "12px 0" }} />

            <div>
              <Text strong>分片并发: {localChunkConcurrency}</Text>
              <Row gutter={16}>
                <Col span={16}>
                  <Slider
                    min={1}
                    max={10}
                    value={localChunkConcurrency}
                    onChange={setLocalChunkConcurrency}
                    marks={{
                      1: "1",
                      2: "2",
                      3: "3",
                      4: "4",
                      5: "5",
                    }}
                  />
                </Col>
                <Col span={8}>
                  <InputNumber
                    min={1}
                    max={10}
                    value={localChunkConcurrency}
                    onChange={(value) =>
                      value !== null && setLocalChunkConcurrency(value)
                    }
                    style={{ width: "100%" }}
                  />
                </Col>
              </Row>
            </div>

            {isManuallySet && (
              <div style={{ marginTop: 16 }}>
                <Text type="secondary">
                  <LockOutlined style={{ marginRight: 8 }} />
                  已启用手动锁定，参数不会自动变化。
                </Text>
              </div>
            )}
          </Space>
        </Modal>
      </>
    );
  }
);
