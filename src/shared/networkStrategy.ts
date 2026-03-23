export interface NetworkProbe {
  rtt?: number;
  online?: boolean;
  effectiveType?: string;
  type?: string;
}

export interface NetworkStrategyResult {
  networkType: string;
  isNetworkOffline: boolean;
  fileConcurrency: number;
  chunkConcurrency: number;
  chunkSize: number;
}

const resolveOffline = (online?: boolean): boolean => {
  const navigatorOnline =
    typeof window !== "undefined" &&
    typeof window.navigator !== "undefined" &&
    window.navigator.onLine === false;

  return online === false || navigatorOnline;
};

export const resolveNetworkStrategy = (
  probe: NetworkProbe
): NetworkStrategyResult => {
  const { rtt, online, effectiveType, type } = probe;
  const isOffline = resolveOffline(online);

  let chunkConcurrency = 2;
  if (!isOffline) {
    if (typeof rtt === "number" && rtt > 0) {
      if (rtt <= 50) chunkConcurrency = 6;
      else if (rtt <= 100) chunkConcurrency = 4;
      else if (rtt <= 200) chunkConcurrency = 3;
      else if (rtt <= 500) chunkConcurrency = 2;
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

  let fileConcurrency = 2;
  if (!isOffline) {
    if (typeof rtt === "number" && rtt > 0) {
      if (rtt <= 50) fileConcurrency = 4;
      else if (rtt <= 100) fileConcurrency = 3;
      else if (rtt <= 200) fileConcurrency = 2;
      else fileConcurrency = 1;
    } else if (type === "wifi" || type === "ethernet") {
      fileConcurrency = 3;
    } else if (effectiveType === "4g") {
      fileConcurrency = 2;
    } else {
      fileConcurrency = 1;
    }
  } else {
    fileConcurrency = 0;
  }

  let chunkSize = 1024 * 1024;
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
    } else if (effectiveType === "2g" || effectiveType === "slow-2g") {
      chunkSize = 256 * 1024;
    }
  } else {
    chunkSize = 512 * 1024;
  }

  const networkType = isOffline ? "offline" : effectiveType || type || "unknown";

  return {
    networkType,
    isNetworkOffline: isOffline,
    fileConcurrency,
    chunkConcurrency,
    chunkSize,
  };
};
