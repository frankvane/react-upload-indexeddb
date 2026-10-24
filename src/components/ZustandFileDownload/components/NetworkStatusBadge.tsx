import React, { useCallback, useRef, useState } from "react";
import {
  Badge,
  Button,
  Space,
  Tooltip,
  message,
} from "../../../ui";
import {
  LockOutlined,
  SettingOutlined,
  SwapOutlined,
  UnlockOutlined,
} from "../../../ui";
import { formatFileSize } from "../utils";
import { useDownloadStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import { NetworkStatusPanel, type NetworkSettings } from "./NetworkStatusPanel";

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

/**
 * 网络状态徽章（精简后）：状态点 + 文案 + 三个工具栏按钮
 * （切换显示模式 / 锁定设置 / 打开设置面板），不再内联"网络设置"对话框。
 * 重活（滑块调节）移到 NetworkStatusPanel。
 */
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

    const badgeRef = useRef<HTMLSpanElement>(null);

    const handleToggleManualFlag = useCallback(() => {
      if (isManuallySet) {
        resetManualFlag();
        message.info("已关闭手动锁定，网络参数将自动调整。");
      } else {
        updateNetworkStatus({}, true);
        message.info("已启用手动锁定，将忽略自动检测到的网络参数。");
      }
    }, [isManuallySet, resetManualFlag, updateNetworkStatus]);

    const applySettings = useCallback(
      async (values: NetworkSettings) => {
        const chunkSizeChanged = chunkSize !== values.chunkSize;
        updateNetworkStatus(
          {
            chunkSize: values.chunkSize,
            fileConcurrency: values.fileConcurrency,
            chunkConcurrency: values.chunkConcurrency,
          },
          true
        );
        message.success(
          `已应用设置：分片 ${formatFileSize(
            values.chunkSize
          )}，文件并发 ${values.fileConcurrency}，分片并发 ${values.chunkConcurrency}`
        );
        if (chunkSizeChanged) {
          await onRefreshFiles(true);
        }
        setIsSettingsVisible(false);
      },
      [chunkSize, updateNetworkStatus, onRefreshFiles]
    );

    const getNetworkInfo = useCallback(() => {
      if (isOffline) {
        return { text: "离线", status: "error" as BadgeStatusType };
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
          <div
            style={{ display: "flex", alignItems: "center", fontSize: "12px" }}
          >
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
          <span ref={badgeRef}>
            <Badge status={networkInfo.status} text={networkInfo.text} />
          </span>
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
            onClick={() => setIsSettingsVisible(true)}
            title="网络设置"
          />
        </Space>

        <NetworkStatusPanel
          visible={isSettingsVisible}
          chunkSize={chunkSize}
          fileConcurrency={fileConcurrency}
          chunkConcurrency={chunkConcurrency}
          isManuallySet={isManuallySet}
          onClose={() => setIsSettingsVisible(false)}
          onApply={applySettings}
        />
      </>
    );
  }
);
