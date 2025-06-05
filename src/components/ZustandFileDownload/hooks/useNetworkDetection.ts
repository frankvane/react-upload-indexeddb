import { NetworkType } from "../types/download";
import { useDownloadStore } from "../store/download";
import { useEffect } from "react";

/**
 * 网络状态检测钩子
 *
 * 监听网络状态变化并更新store
 */
const useNetworkDetection = () => {
  const { updateNetworkStatus } = useDownloadStore();

  useEffect(() => {
    // 初始化网络状态
    updateNetworkStatus(!navigator.onLine, getNetworkType());

    // 监听网络状态变化
    const handleOnline = () => {
      updateNetworkStatus(false, getNetworkType());
    };

    const handleOffline = () => {
      updateNetworkStatus(true, NetworkType.OFFLINE);
    };

    // 监听网络连接类型变化
    const handleConnectionChange = () => {
      updateNetworkStatus(!navigator.onLine, getNetworkType());
    };

    // 添加事件监听器
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // 如果支持NetworkInformation API，监听连接类型变化
    if (navigator.connection) {
      navigator.connection.addEventListener("change", handleConnectionChange);
    }

    // 清理函数
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);

      if (navigator.connection) {
        navigator.connection.removeEventListener(
          "change",
          handleConnectionChange
        );
      }
    };
  }, [updateNetworkStatus]);

  /**
   * 获取当前网络类型
   */
  const getNetworkType = (): NetworkType => {
    if (!navigator.onLine) {
      return NetworkType.OFFLINE;
    }

    // 如果浏览器支持NetworkInformation API
    if (navigator.connection) {
      const { effectiveType, type } = navigator.connection;

      if (type) {
        switch (type) {
          case "ethernet":
            return NetworkType.ETHERNET;
          case "wifi":
            return NetworkType.WIFI;
          case "cellular":
            return NetworkType.CELLULAR;
          default:
            break;
        }
      }

      // 根据有效连接类型判断
      if (effectiveType) {
        switch (effectiveType) {
          case "slow-2g":
          case "2g":
            return NetworkType.CELLULAR_2G;
          case "3g":
            return NetworkType.CELLULAR_3G;
          case "4g":
            return NetworkType.CELLULAR_4G;
          default:
            break;
        }
      }
    }

    return NetworkType.UNKNOWN;
  };

  return null;
};

// 为TypeScript添加网络连接类型定义
declare global {
  interface Navigator {
    connection?: {
      effectiveType?: string;
      type?: string;
      addEventListener: (type: string, listener: EventListener) => void;
      removeEventListener: (type: string, listener: EventListener) => void;
    };
  }
}

export default useNetworkDetection;
