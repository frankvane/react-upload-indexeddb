import { useState, useCallback } from "react";

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  category: 'upload' | 'download' | 'network' | 'storage' | 'system';
  message: string;
  data?: any;
}

export const useDebugLogger = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const addLog = useCallback((
    level: LogEntry['level'],
    category: LogEntry['category'],
    message: string,
    data?: any
  ) => {
    const newLog: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toLocaleTimeString(),
      level,
      category,
      message,
      data
    };

    setLogs(prev => [...prev, newLog]);

    // 同时输出到控制台
    const emoji = {
      info: 'ℹ️',
      success: '✅',
      warning: '⚠️',
      error: '❌'
    }[level];

    const categoryEmoji = {
      upload: '📤',
      download: '📥',
      network: '🌐',
      storage: '💾',
      system: '⚙️'
    }[category];

    console.log(`${emoji} ${categoryEmoji} [${category.toUpperCase()}] ${message}`, data || '');
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    console.clear();
  }, []);

  // 便捷方法
  const logInfo = useCallback((category: LogEntry['category'], message: string, data?: any) => {
    addLog('info', category, message, data);
  }, [addLog]);

  const logSuccess = useCallback((category: LogEntry['category'], message: string, data?: any) => {
    addLog('success', category, message, data);
  }, [addLog]);

  const logWarning = useCallback((category: LogEntry['category'], message: string, data?: any) => {
    addLog('warning', category, message, data);
  }, [addLog]);

  const logError = useCallback((category: LogEntry['category'], message: string, data?: any) => {
    addLog('error', category, message, data);
  }, [addLog]);

  return {
    logs,
    addLog,
    clearLogs,
    logInfo,
    logSuccess,
    logWarning,
    logError
  };
};
