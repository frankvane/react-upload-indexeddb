import { useEffect, useRef } from "react";

import { useDownloadStore } from "../store";
import { useNetwork } from "ahooks";

/**
 * 网络状态检测钩子
 * 监听网络状态变化，更新Zustand store中的网络参数
 * 如果isManuallySet为true，则只更新网络类型和离线状态，不更新其他参数
 */
export function useNetworkDetection() {
  const network = useNetwork();
  const { rtt, online, effectiveType, type } = network;

  // 使用单独的选择器以避免不必要的重渲染
  const updateNetworkStatus = useDownloadStore(
    (state) => state.updateNetworkStatus
  );
  const isManuallySet = useDownloadStore((state) => state.isManuallySet);

  // 使用ref跟踪上一次的网络状态，避免不必要的更新
  const prevNetworkState = useRef({
    rtt,
    online,
    effectiveType,
    type,
    isManuallySet,
  });

  useEffect(() => {
    // 检查网络状态是否真的发生了变化
    const hasNetworkChanged =
      prevNetworkState.current.rtt !== rtt ||
      prevNetworkState.current.online !== online ||
      prevNetworkState.current.effectiveType !== effectiveType ||
      prevNetworkState.current.type !== type ||
      prevNetworkState.current.isManuallySet !== isManuallySet;

    // 如果网络状态没有变化，则不更新
    if (!hasNetworkChanged) {
      return;
    }

    // 更新上一次的网络状态
    prevNetworkState.current = {
      rtt,
      online,
      effectiveType,
      type,
      isManuallySet,
    };

    /**
     * 是否离线
     */
    const isOffline =
      online === false ||
      (typeof window !== "undefined" &&
        typeof window.navigator !== "undefined" &&
        window.navigator.onLine === false);

    /**
     * 网络类型字符串
     */
    const networkType = isOffline
      ? "offline"
      : effectiveType || type || "unknown";

    // 如果是手动设置模式，只更新网络类型和离线状态
    if (isManuallySet) {
      updateNetworkStatus({
        networkType,
        isNetworkOffline: isOffline,
      });
      return;
    }

    /**
     * 动态分片并发数（单文件分片上传并发）
     */
    let chunkConcurrency = 2;
    if (!isOffline) {
      if (typeof rtt === "number" && rtt > 0) {
        if (rtt <= 50) chunkConcurrency = 6;
        else if (rtt <= 100) chunkConcurrency = 4;
        else if (rtt <= 200) chunkConcurrency = 3;
        else if (rtt <= 500) chunkConcurrency = 2;
        else if (rtt <= 1000) chunkConcurrency = 1;
        else chunkConcurrency = 1;
      } else if (type === "wifi") {
        if (effectiveType === "4g") chunkConcurrency = 4;
        else if (effectiveType === "3g") chunkConcurrency = 3;
        else chunkConcurrency = 2;
      } else if (type === "ethernet") {
        chunkConcurrency = 4;
      } else if (effectiveType === "4g") {
        chunkConcurrency = 3;
      } else if (effectiveType === "3g") {
        chunkConcurrency = 2;
      } else if (effectiveType === "2g" || effectiveType === "slow-2g") {
        chunkConcurrency = 1;
      }
    } else {
      chunkConcurrency = 0;
    }

    /**
     * 动态文件并发数（同一时刻最大活跃上传文件数）
     * - 网络越好并发越高，网络差并发越低
     */
    let fileConcurrency = 2;
    if (!isOffline) {
      if (typeof rtt === "number" && rtt > 0) {
        if (rtt <= 50) fileConcurrency = 4;
        else if (rtt <= 100) fileConcurrency = 3;
        else if (rtt <= 200) fileConcurrency = 2;
        else if (rtt <= 500) fileConcurrency = 1;
        else fileConcurrency = 1;
      } else if (type === "wifi" || type === "ethernet") {
        fileConcurrency = 3;
      } else if (effectiveType === "4g") {
        fileConcurrency = 2;
      } else if (effectiveType === "3g") {
        fileConcurrency = 1;
      } else {
        fileConcurrency = 1;
      }
    } else {
      fileConcurrency = 0;
    }

    /**
     * 动态切片大小（字节）
     * - 网络越好切片越大，网络差切片越小
     */
    let chunkSize = 1024 * 1024; // 默认1MB
    if (!isOffline) {
      if (typeof rtt === "number" && rtt > 0) {
        if (rtt <= 50) chunkSize = 8 * 1024 * 1024;
        else if (rtt <= 100) chunkSize = 4 * 1024 * 1024;
        else if (rtt <= 200) chunkSize = 2 * 1024 * 1024;
        else if (rtt <= 500) chunkSize = 1 * 1024 * 1024;
        else if (rtt <= 1000) chunkSize = 512 * 1024;
        else chunkSize = 256 * 1024;
      } else if (type === "wifi" || type === "ethernet") {
        chunkSize = 4 * 1024 * 1024;
      } else if (effectiveType === "4g") {
        chunkSize = 2 * 1024 * 1024;
      } else if (effectiveType === "3g") {
        chunkSize = 1 * 1024 * 1024;
      } else if (effectiveType === "2g" || effectiveType === "slow-2g") {
        chunkSize = 256 * 1024;
      } else {
        chunkSize = 1 * 1024 * 1024;
      }
    } else {
      chunkSize = 512 * 1024;
    }

    // 更新Zustand store
    updateNetworkStatus({
      networkType,
      isNetworkOffline: isOffline,
      fileConcurrency,
      chunkConcurrency,
      chunkSize,
    });
  }, [rtt, online, effectiveType, type, updateNetworkStatus, isManuallySet]);
}
