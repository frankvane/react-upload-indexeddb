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
import { useDownloadFiles } from "../hooks/useDownloadFiles";
import { useDownloadStore } from "../store";

const { Text } = Typography;

type BadgeStatusType =
  | "success"
  | "processing"
  | "default"
  | "error"
  | "warning";

interface NetworkStatusBadgeProps {
  isOffline: boolean;
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
  ({ isOffline }) => {
    const networkType = useDownloadStore((state) => state.networkType);
    const chunkSize = useDownloadStore((state) => state.chunkSize);
    const fileConcurrency = useDownloadStore((state) => state.fileConcurrency);
    const chunkConcurrency = useDownloadStore(
      (state) => state.chunkConcurrency
    );
    const isManuallySet = useDownloadStore((state) => state.isManuallySet);
    const displayMode = useDownloadStore((state) => state.displayMode);

    const updateNetworkStatus = useDownloadStore(
      (state) => state.updateNetworkStatus
    );
    const resetManualFlag = useDownloadStore((state) => state.resetManualFlag);
    const toggleDisplayMode = useDownloadStore(
      (state) => state.toggleDisplayMode
    );

    const { fetchFileList } = useDownloadFiles();

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
        message.info("已解除手动设置锁定，网络参数将自动适应网络状态");
      } else {
        updateNetworkStatus({}, true);
        message.info("已锁定网络参数，将忽略自动检测的网络状态");
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

    const applySettings = useCallback(() => {
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
        `已应用网络设置：分片大小 ${formatFileSize(
          localChunkSize
        )}，文件并发 ${localFileConcurrency}，分片并发 ${localChunkConcurrency}`
      );

      if (chunkSizeChanged) {
        fetchFileList(true);
      }

      hideSettings();
    }, [
      chunkSize,
      localChunkSize,
      localFileConcurrency,
      localChunkConcurrency,
      updateNetworkStatus,
      fetchFileList,
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
    }, [isOffline, networkType]);

    const networkInfo = getNetworkInfo();

    const renderContent = useCallback(() => {
      const networkDetails = (
        <>
          <div>网络类型: {networkInfo.text}</div>
          <div>分片大小: {formatFileSize(chunkSize)}</div>
          <div>文件并发: {fileConcurrency}</div>
          <div>分片并发: {chunkConcurrency}</div>
          <div>手动设置: {isManuallySet ? "是" : "否"}</div>
        </>
      );

      if (displayMode === "direct") {
        return (
          <div
            style={{ display: "flex", alignItems: "center", fontSize: "12px" }}
          >
            <Badge status={networkInfo.status} text={networkInfo.text} />
            <span style={{ marginLeft: 8 }}>
              {formatFileSize(chunkSize)} | {fileConcurrency}文件 |{" "}
              {chunkConcurrency}分片
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
      badgeRef,
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
            title={`切换到${displayMode === "tooltip" ? "详细" : "简洁"}模式`}
          />
          <Button
            type="link"
            icon={isManuallySet ? <LockOutlined /> : <UnlockOutlined />}
            size="small"
            onClick={handleToggleManualFlag}
            title={isManuallySet ? "解除锁定" : "锁定设置"}
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
                    onChange={(value) =>
                      value && setLocalChunkSize(value * 1024)
                    }
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
                      value && setLocalFileConcurrency(value)
                    }
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
                      value && setLocalChunkConcurrency(value)
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
                  网络参数已锁定，不会随网络状态自动变化
                </Text>
              </div>
            )}
          </Space>
        </Modal>
      </>
    );
  }
);
