import { useEffect, useMemo, useRef } from "react";

import { useNetwork } from "ahooks";

/**
 * 网络类型与自适应上传参数 Hook
 * 根据网络状况动态计算并发数和切片大小，支持回调通知。
 * @param onChange 可选，网络参数变化时的回调，返回 { networkType, fileConcurrency, chunkConcurrency, chunkSize }
 * @returns { networkType, fileConcurrency, chunkConcurrency, chunkSize }
 */
export function useNetworkType(
  onChange?: (params: {
    networkType: string;
    fileConcurrency: number;
    chunkConcurrency: number;
    chunkSize: number;
  }) => void
) {
  const network = useNetwork();
  const { rtt, online, effectiveType, type } = network;

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
  const chunkConcurrency = useMemo(() => {
    if (isOffline) return 0;
    if (typeof rtt === "number" && rtt > 0) {
      if (rtt <= 50) return 6;
      if (rtt <= 100) return 4;
      if (rtt <= 200) return 3;
      if (rtt <= 500) return 2;
      if (rtt <= 1000) return 1;
      return 1;
    }
    if (type === "wifi") {
      if (effectiveType === "4g") return 4;
      if (effectiveType === "3g") return 3;
      return 2;
    }
    if (type === "ethernet") return 4;
    if (effectiveType === "4g") return 3;
    if (effectiveType === "3g") return 2;
    if (effectiveType === "2g") return 1;
    if (effectiveType === "slow-2g") return 1;
    return 2;
  }, [rtt, isOffline, effectiveType, type]);

  /**
   * 动态文件并发数（同一时刻最大活跃上传文件数）
   * - 网络越好并发越高，网络差并发越低
   */
  const fileConcurrency = useMemo(() => {
    if (isOffline) return 0;
    if (typeof rtt === "number" && rtt > 0) {
      if (rtt <= 50) return 4;
      if (rtt <= 100) return 3;
      if (rtt <= 200) return 2;
      if (rtt <= 500) return 1;
      return 1;
    }
    if (type === "wifi" || type === "ethernet") return 3;
    if (effectiveType === "4g") return 2;
    if (effectiveType === "3g") return 1;
    return 1;
  }, [rtt, isOffline, effectiveType, type]);

  /**
   * 动态切片大小（字节）
   * - 网络越好切片越大，网络差切片越小
   */
  const chunkSize = useMemo(() => {
    if (isOffline) return 512 * 1024;
    if (typeof rtt === "number" && rtt > 0) {
      if (rtt <= 50) return 8 * 1024 * 1024;
      if (rtt <= 100) return 4 * 1024 * 1024;
      if (rtt <= 200) return 2 * 1024 * 1024;
      if (rtt <= 500) return 1 * 1024 * 1024;
      if (rtt <= 1000) return 512 * 1024;
      return 256 * 1024;
    }
    if (type === "wifi" || type === "ethernet") return 4 * 1024 * 1024;
    if (effectiveType === "4g") return 2 * 1024 * 1024;
    if (effectiveType === "3g") return 1 * 1024 * 1024;
    if (effectiveType === "2g" || effectiveType === "slow-2g")
      return 256 * 1024;
    return 1 * 1024 * 1024;
  }, [rtt, isOffline, effectiveType, type]);

  /**
   * 网络类型字符串
   */
  const networkType = isOffline
    ? "offline"
    : effectiveType || type || "unknown";

  // 变化时触发回调
  const prev = useRef<{
    networkType: string;
    fileConcurrency: number;
    chunkConcurrency: number;
    chunkSize: number;
  }>();
  useEffect(() => {
    if (
      prev.current?.networkType !== networkType ||
      prev.current?.fileConcurrency !== fileConcurrency ||
      prev.current?.chunkConcurrency !== chunkConcurrency ||
      prev.current?.chunkSize !== chunkSize
    ) {
      onChange?.({ networkType, fileConcurrency, chunkConcurrency, chunkSize });
      prev.current = {
        networkType,
        fileConcurrency,
        chunkConcurrency,
        chunkSize,
      };
    }
  }, [networkType, fileConcurrency, chunkConcurrency, chunkSize, onChange]);

  return { networkType, fileConcurrency, chunkConcurrency, chunkSize };
}
