import { useEffect, useState } from "react";

interface LocalStorageSettings {
  autoUpload: boolean;
  setAutoUpload: (value: boolean) => void;
  networkDisplayMode: "tooltip" | "direct";
  setNetworkDisplayMode: (mode: "tooltip" | "direct") => void;
}

export const useLocalStorageSettings = (): LocalStorageSettings => {
  // 从localStorage读取自动上传设置，默认为true
  const [autoUpload, setAutoUpload] = useState(() => {
    const savedValue = localStorage.getItem("autoUpload");
    return savedValue !== null ? savedValue === "true" : true;
  });

  // 从localStorage读取显示模式设置，默认为简洁模式（tooltip）
  const [networkDisplayMode, setNetworkDisplayMode] = useState<
    "tooltip" | "direct"
  >(() => {
    const savedMode = localStorage.getItem("networkDisplayMode");
    return savedMode === "direct" ? "direct" : "tooltip";
  });

  // 当autoUpload状态变化时，保存到localStorage
  useEffect(() => {
    localStorage.setItem("autoUpload", String(autoUpload));
  }, [autoUpload]);

  // 当networkDisplayMode状态变化时，保存到localStorage
  useEffect(() => {
    localStorage.setItem("networkDisplayMode", networkDisplayMode);
  }, [networkDisplayMode]);

  return {
    autoUpload,
    setAutoUpload,
    networkDisplayMode,
    setNetworkDisplayMode,
  };
};
