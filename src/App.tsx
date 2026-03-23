import { API_BASE_URL, API_PATHS } from "./config/api";
import {
  CSSProperties,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  DownloadFile,
  StorageStats,
} from "./components/ZustandFileDownload/types/download";

import type { UploadFile } from "./components/ZustandFileUpload/types/upload";
import { useDebugLogger } from "./hooks/useDebugLogger";

const ZustandFileUpload = lazy(() => import("./components/ZustandFileUpload"));
const ZustandFileDownload = lazy(
  () => import("./components/ZustandFileDownload"),
);
const DebugPanel = lazy(() => import("./components/DebugPanel"));
const SimpleUploadList = lazy(() => import("./components/SimpleUploadList"));

interface UploadBatchResult {
  success: number;
  failed: number;
  total: number;
}

type NoticeLevel = "info" | "success" | "error";

interface NoticeItem {
  id: number;
  level: NoticeLevel;
  text: string;
}

if (import.meta.env.DEV) {
  import("./utils/clearIndexedDB");
}

const noticeStyleMap: Record<NoticeLevel, CSSProperties> = {
  info: {
    backgroundColor: "#e6f4ff",
    color: "#0958d9",
    borderColor: "#91caff",
  },
  success: {
    backgroundColor: "#f6ffed",
    color: "#237804",
    borderColor: "#b7eb8f",
  },
  error: {
    backgroundColor: "#fff2f0",
    color: "#cf1322",
    borderColor: "#ffccc7",
  },
};

const tabButtonStyle = (isActive: boolean): CSSProperties => ({
  border: "1px solid #d0d7de",
  background: isActive ? "#1677ff" : "#fff",
  color: isActive ? "#fff" : "#111827",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
});

const App = () => {
  const [activeTab, setActiveTab] = useState<"upload" | "download" | "simple">(
    "upload",
  );
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [notices, setNotices] = useState<NoticeItem[]>([]);

  const noticeTimersRef = useRef<Map<number, number>>(new Map());
  const noticeIdRef = useRef(0);

  const { logs, clearLogs, logInfo, logSuccess, logError } = useDebugLogger();

  const dismissNotice = useCallback((id: number) => {
    const timer = noticeTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      noticeTimersRef.current.delete(id);
    }

    setNotices((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (level: NoticeLevel, text: string) => {
      const id = (noticeIdRef.current += 1);
      const maxNoticeCount = 4;

      setNotices((prev) => {
        const next = [...prev, { id, level, text }];
        if (next.length <= maxNoticeCount) {
          return next;
        }

        const removed = next.slice(0, next.length - maxNoticeCount);
        for (const item of removed) {
          const timer = noticeTimersRef.current.get(item.id);
          if (timer !== undefined) {
            window.clearTimeout(timer);
            noticeTimersRef.current.delete(item.id);
          }
        }

        return next.slice(-maxNoticeCount);
      });

      const timer = window.setTimeout(() => {
        dismissNotice(id);
      }, 2500);
      noticeTimersRef.current.set(id, timer);
    },
    [dismissNotice],
  );

  useEffect(() => {
    const timers = noticeTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const handleUploadStart = (files: UploadFile[]) => {
    logInfo("upload", `开始上传 ${files.length} 个文件`, {
      fileCount: files.length,
      files: files.map((f) => f.fileName),
    });
    notify("info", `开始上传 ${files.length} 个文件`);
  };

  const handleUploadProgress = (file: UploadFile, progress: number) => {
    if (progress % 25 === 0 || progress === 100) {
      logInfo("upload", `${file.fileName} 上传进度: ${progress}%`, {
        fileName: file.fileName,
        progress,
      });
    }
  };

  const handleUploadComplete = (file: UploadFile, success: boolean) => {
    if (success) {
      logSuccess("upload", `上传成功: ${file.fileName}`, {
        fileName: file.fileName,
        fileSize: file.fileSize,
      });
      notify("success", `上传成功: ${file.fileName}`);
      return;
    }

    logError("upload", `上传失败: ${file.fileName}`, {
      fileName: file.fileName,
    });
    notify("error", `上传失败: ${file.fileName}`);
  };

  const handleUploadError = (file: UploadFile, error: string) => {
    logError("upload", `${file.fileName} 上传错误: ${error}`, {
      fileName: file.fileName,
      error,
    });
    notify("error", `${file.fileName} 上传错误: ${error}`);
  };

  const handleUploadBatchComplete = (results: UploadBatchResult) => {
    logSuccess(
      "upload",
      `批量上传完成: 成功 ${results.success} 个, 失败 ${results.failed} 个`,
      results,
    );
    notify(
      "success",
      `批量上传完成: 成功 ${results.success} 个, 失败 ${results.failed} 个`,
    );
  };

  const handleDownloadStart = useCallback(
    (file: DownloadFile) => {
      logInfo("download", `开始下载 ${file.fileName}`, {
        fileName: file.fileName,
        fileSize: file.fileSize,
      });
      notify("info", `开始下载 ${file.fileName}`);
    },
    [logInfo, notify],
  );

  const handleDownloadProgress = useCallback(
    (file: DownloadFile, progress: number) => {
      if (progress % 25 === 0 || progress === 100) {
        logInfo("download", `${file.fileName} 下载进度: ${progress}%`, {
          fileName: file.fileName,
          progress,
        });
      }
    },
    [logInfo],
  );

  const handleDownloadComplete = useCallback(
    (file: DownloadFile, success: boolean) => {
      if (success) {
        logSuccess("download", `下载成功: ${file.fileName}`, {
          fileName: file.fileName,
          fileSize: file.fileSize,
        });
        notify("success", `下载成功: ${file.fileName}`);
      } else {
        logError("download", `下载失败: ${file.fileName}`, {
          fileName: file.fileName,
        });
        notify("error", `下载失败: ${file.fileName}`);
      }
    },
    [logSuccess, logError, notify],
  );

  const handleDownloadError = useCallback(
    (file: DownloadFile, error: string) => {
      logError("download", `${file.fileName} 下载错误: ${error}`, {
        fileName: file.fileName,
        error,
      });
      notify("error", `${file.fileName} 下载错误: ${error}`);
    },
    [logError, notify],
  );

  const handleDownloadBatchComplete = useCallback(
    (results: { success: number; failed: number; total: number }) => {
      logSuccess(
        "download",
        `批量下载完成: 成功 ${results.success} 个, 失败 ${results.failed} 个`,
        results,
      );
      notify(
        "success",
        `批量下载完成: 成功 ${results.success} 个, 失败 ${results.failed} 个`,
      );
    },
    [logSuccess, notify],
  );

  const handleStorageChange = useCallback(
    (stats: StorageStats) => {
      logInfo(
        "storage",
        `存储使用更新: ${stats.percentage.toFixed(1)}% (${(
          stats.used /
          1024 /
          1024
        ).toFixed(1)}MB / ${(stats.total / 1024 / 1024).toFixed(1)}MB)`,
        stats,
      );
    },
    [logInfo],
  );

  const handleSimpleServerListChange = useCallback(
    (files: { id: string }[]) => {
      logInfo("system", `Simple mode list refreshed: ${files.length}`, {
        total: files.length,
      });
    },
    [logInfo],
  );

  const customFileValidator = (file: File) => {
    if (file.name.includes("test")) {
      return { valid: false, message: "文件名包含 test 时不允许上传" };
    }
    if (file.size > 500 * 1024 * 1024) {
      return { valid: false, message: "文件大小不能超过 500MB" };
    }
    return { valid: true };
  };

  return (
    <div
      style={{ padding: 16, minHeight: "100vh", backgroundColor: "#f5f7fb" }}
    >
      <h2 style={{ margin: 0, marginBottom: 12 }}>上传/下载组件演示</h2>

      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "min(420px, calc(100vw - 32px))",
          pointerEvents: "none",
        }}
      >
        {notices.map((notice) => (
          <div
            key={notice.id}
            style={{
              ...noticeStyleMap[notice.level],
              borderWidth: 1,
              borderStyle: "solid",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 13,
              boxShadow: "0 8px 20px rgba(0, 0, 0, 0.08)",
              pointerEvents: "auto",
            }}
          >
            {notice.text}
          </div>
        ))}
      </div>

      <div
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              clearLogs();
              notify("success", "调试日志已清空");
            }}
          >
            清空调试日志
          </button>
          <button
            type="button"
            onClick={() => {
              logInfo("system", `当前标签页: ${activeTab}`, {
                activeTab,
                timestamp: new Date().toISOString(),
              });
              logInfo("system", `日志总数: ${logs.length}`, {
                logCount: logs.length,
              });
              notify("info", "调试信息已写入日志");
            }}
          >
            记录调试信息
          </button>
          <button
            type="button"
            onClick={() => setShowDebugPanel((prev) => !prev)}
          >
            {showDebugPanel ? "隐藏调试面板" : "显示调试面板"}
          </button>
        </div>
      </div>

      {showDebugPanel && (
        <Suspense fallback={<div>正在加载调试面板...</div>}>
          <DebugPanel logs={logs} onClearLogs={clearLogs} />
        </Suspense>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setActiveTab("upload")}
          style={tabButtonStyle(activeTab === "upload")}
        >
          上传
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("download")}
          style={tabButtonStyle(activeTab === "download")}
        >
          下载
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("simple")}
          style={tabButtonStyle(activeTab === "simple")}
        >
          简化模式
        </button>
      </div>

      <div
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 12,
        }}
      >
        {activeTab === "upload" ? (
          <Suspense fallback={<div>正在加载上传组件...</div>}>
            <ZustandFileUpload
              baseURL={API_BASE_URL}
              uploadApi={API_PATHS.file.upload}
              checkApi={API_PATHS.file.instant}
              chunkSize={1024 * 1024}
              fileConcurrency={2}
              chunkConcurrency={2}
              maxRetries={3}
              maxFileSize={100 * 1024 * 1024}
              allowedFileTypes={[]}
              maxFiles={10}
              autoUpload={true}
              autoCleanup={true}
              cleanupDelay={5}
              networkDisplayMode="tooltip"
              onUploadStart={handleUploadStart}
              onUploadProgress={handleUploadProgress}
              onUploadComplete={handleUploadComplete}
              onUploadError={handleUploadError}
              onBatchComplete={handleUploadBatchComplete}
              customFileValidator={customFileValidator}
            />
          </Suspense>
        ) : activeTab === "download" ? (
          <Suspense fallback={<div>正在加载下载组件...</div>}>
            <ZustandFileDownload
              baseURL={API_BASE_URL}
              listApi={API_PATHS.file.list}
              downloadApi={API_PATHS.file.download}
              chunkSize={2 * 1024 * 1024}
              maxConcurrency={3}
              maxRetries={5}
              retryDelay={2000}
              autoStart={false}
              showProgress={true}
              showStorageStats={true}
              showNetworkStatus={true}
              onDownloadStart={handleDownloadStart}
              onDownloadProgress={handleDownloadProgress}
              onDownloadComplete={handleDownloadComplete}
              onDownloadError={handleDownloadError}
              onBatchComplete={handleDownloadBatchComplete}
              onStorageChange={handleStorageChange}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<div>正在加载简化模式...</div>}>
            <SimpleUploadList
              baseURL={API_BASE_URL}
              uploadApi={API_PATHS.file.upload}
              checkApi={API_PATHS.file.instant}
              listApi={API_PATHS.file.list}
              onServerListChange={handleSimpleServerListChange}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export default App;
