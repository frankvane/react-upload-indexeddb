import { useEffect } from "react";
import { useNetwork } from "ahooks";
import { useUploadStore } from "../store/upload";

/**
 * 网络状态检测钩子
 * 监听网络状态变化，更新Zustand store中的网络参数
 */
export function useNetworkDetection() {
  const network = useNetwork();
  const { rtt, online, effectiveType, type } = network;

  useEffect(() => {
    /**
     * 是否离线
     */
    const isOffline =
      online === false ||
      (typeof window !== "undefined" &&
        typeof window.navigator !== "undefined" &&
        window.navigator.onLine === false);

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

    /**
     * 网络类型字符串
     */
    const networkType = isOffline
      ? "offline"
      : effectiveType || type || "unknown";

    // 更新Zustand store
    useUploadStore.setState({
      networkType,
      isNetworkOffline: isOffline,
      fileConcurrency,
      chunkConcurrency,
      chunkSize,
    });
  }, [rtt, online, effectiveType, type]);
}
