import { useEffect, useRef } from "react";

import { resolveNetworkStrategy } from "../../../shared/networkStrategy";
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

  const updateNetworkStatus = useDownloadStore(
    (state) => state.updateNetworkStatus
  );
  const isManuallySet = useDownloadStore((state) => state.isManuallySet);

  const prevNetworkState = useRef({
    rtt,
    online,
    effectiveType,
    type,
    isManuallySet,
  });

  useEffect(() => {
    const hasNetworkChanged =
      prevNetworkState.current.rtt !== rtt ||
      prevNetworkState.current.online !== online ||
      prevNetworkState.current.effectiveType !== effectiveType ||
      prevNetworkState.current.type !== type ||
      prevNetworkState.current.isManuallySet !== isManuallySet;

    if (!hasNetworkChanged) {
      return;
    }

    prevNetworkState.current = {
      rtt,
      online,
      effectiveType,
      type,
      isManuallySet,
    };

    const strategy = resolveNetworkStrategy({
      rtt,
      online,
      effectiveType,
      type,
    });

    if (isManuallySet) {
      updateNetworkStatus({
        networkType: strategy.networkType,
        isNetworkOffline: strategy.isNetworkOffline,
      });
      return;
    }

    updateNetworkStatus(strategy);
  }, [rtt, online, effectiveType, type, updateNetworkStatus, isManuallySet]);
}
