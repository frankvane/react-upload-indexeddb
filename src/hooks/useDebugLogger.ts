import { useCallback, useState } from "react";

interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  category: "upload" | "download" | "network" | "storage" | "system";
  message: string;
  data?: unknown;
}

const levelPrefixMap: Record<LogEntry["level"], string> = {
  info: "[INFO]",
  success: "[SUCCESS]",
  warning: "[WARNING]",
  error: "[ERROR]",
};

const categoryPrefixMap: Record<LogEntry["category"], string> = {
  upload: "[UPLOAD]",
  download: "[DOWNLOAD]",
  network: "[NETWORK]",
  storage: "[STORAGE]",
  system: "[SYSTEM]",
};

export const useDebugLogger = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback(
    (
      level: LogEntry["level"],
      category: LogEntry["category"],
      message: string,
      data?: unknown
    ) => {
      const newLog: LogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        timestamp: new Date().toLocaleTimeString(),
        level,
        category,
        message,
        data,
      };

      setLogs((prev) => [...prev, newLog]);
      console.log(
        `${levelPrefixMap[level]} ${categoryPrefixMap[category]} ${message}`,
        data || ""
      );
    },
    []
  );

  const clearLogs = useCallback(() => {
    setLogs([]);
    console.clear();
  }, []);

  const logInfo = useCallback(
    (category: LogEntry["category"], message: string, data?: unknown) => {
      addLog("info", category, message, data);
    },
    [addLog]
  );

  const logSuccess = useCallback(
    (category: LogEntry["category"], message: string, data?: unknown) => {
      addLog("success", category, message, data);
    },
    [addLog]
  );

  const logWarning = useCallback(
    (category: LogEntry["category"], message: string, data?: unknown) => {
      addLog("warning", category, message, data);
    },
    [addLog]
  );

  const logError = useCallback(
    (category: LogEntry["category"], message: string, data?: unknown) => {
      addLog("error", category, message, data);
    },
    [addLog]
  );

  return {
    logs,
    addLog,
    clearLogs,
    logInfo,
    logSuccess,
    logWarning,
    logError,
  };
};
