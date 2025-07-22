import { Button, Card, Space, Tabs, message } from "antd";
import {
  DownloadFile,
  StorageStats,
} from "./components/ZustandFileDownload/types/download";
import { useCallback, useState } from "react";

import DebugPanel from "./components/DebugPanel";
import ZustandFileDownload from "./components/ZustandFileDownload";
import ZustandFileUpload from "./components/ZustandFileUpload";
import { useDebugLogger } from "./hooks/useDebugLogger";

// 导入 IndexedDB 清理工具（仅在开发环境）
if (import.meta.env.DEV) {
  import("./utils/clearIndexedDB");
}

const App = () => {
  const [messageApi, contextHolder] = message.useMessage();
  const [activeTab, setActiveTab] = useState("upload");

  // 使用调试日志系统
  const { logs, clearLogs, logInfo, logSuccess, logError } = useDebugLogger();

  // 上传组件回调函数
  const handleUploadStart = (files: any[]) => {
    logInfo("upload", `开始上传 ${files.length} 个文件`, {
      fileCount: files.length,
      files: files.map((f) => f.fileName),
    });
    messageApi.info(`开始上传 ${files.length} 个文件`);
  };

  const handleUploadProgress = (file: any, progress: number) => {
    // 只在特定进度点记录日志，避免日志过多
    if (progress % 25 === 0 || progress === 100) {
      logInfo("upload", `文件 ${file.fileName} 上传进度: ${progress}%`, {
        fileName: file.fileName,
        progress,
      });
    }
  };

  const handleUploadComplete = (file: any, success: boolean) => {
    if (success) {
      logSuccess("upload", `文件 ${file.fileName} 上传成功`, {
        fileName: file.fileName,
        fileSize: file.fileSize,
      });
      messageApi.success(`文件 ${file.fileName} 上传成功`);
    } else {
      logError("upload", `文件 ${file.fileName} 上传失败`, {
        fileName: file.fileName,
      });
      messageApi.error(`文件 ${file.fileName} 上传失败`);
    }
  };

  const handleUploadError = (file: any, error: string) => {
    logError("upload", `文件 ${file.fileName} 上传错误: ${error}`, {
      fileName: file.fileName,
      error,
    });
    messageApi.error(`文件 ${file.fileName} 上传错误: ${error}`);
  };

  const handleUploadBatchComplete = (results: any) => {
    logSuccess(
      "upload",
      `批量上传完成: 成功 ${results.success} 个，失败 ${results.failed} 个`,
      results
    );
    messageApi.success(
      `批量上传完成: 成功 ${results.success} 个，失败 ${results.failed} 个`
    );
  };

  // 下载组件回调函数
  const handleDownloadStart = useCallback(
    (file: DownloadFile) => {
      logInfo("download", `开始下载文件: ${file.fileName}`, {
        fileName: file.fileName,
        fileSize: file.fileSize,
      });
      messageApi.info(`开始下载文件: ${file.fileName}`);
    },
    [logInfo, messageApi]
  );

  const handleDownloadProgress = useCallback(
    (file: DownloadFile, progress: number) => {
      // 只在特定进度点记录日志，避免日志过多
      if (progress % 25 === 0 || progress === 100) {
        logInfo("download", `文件 ${file.fileName} 下载进度: ${progress}%`, {
          fileName: file.fileName,
          progress,
        });
      }
    },
    [logInfo]
  );

  const handleDownloadComplete = useCallback(
    (file: DownloadFile, success: boolean) => {
      if (success) {
        logSuccess("download", `文件 ${file.fileName} 下载成功`, {
          fileName: file.fileName,
          fileSize: file.fileSize,
        });
        messageApi.success(`文件 ${file.fileName} 下载成功`);
      } else {
        logError("download", `文件 ${file.fileName} 下载失败`, {
          fileName: file.fileName,
        });
        messageApi.error(`文件 ${file.fileName} 下载失败`);
      }
    },
    [logSuccess, logError, messageApi]
  );

  const handleDownloadError = useCallback(
    (file: DownloadFile, error: string) => {
      logError("download", `文件 ${file.fileName} 下载错误: ${error}`, {
        fileName: file.fileName,
        error,
      });
      messageApi.error(`文件 ${file.fileName} 下载错误: ${error}`);
    },
    [logError, messageApi]
  );

  const handleDownloadBatchComplete = useCallback(
    (results: { success: number; failed: number; total: number }) => {
      logSuccess(
        "download",
        `批量下载完成: 成功 ${results.success} 个，失败 ${results.failed} 个`,
        results
      );
      messageApi.success(
        `批量下载完成: 成功 ${results.success} 个，失败 ${results.failed} 个`
      );
    },
    [logSuccess, messageApi]
  );

  const handleStorageChange = useCallback(
    (stats: StorageStats) => {
      logInfo(
        "storage",
        `存储使用情况变化: ${stats.percentage.toFixed(1)}% (${(
          stats.used /
          1024 /
          1024
        ).toFixed(1)}MB / ${(stats.total / 1024 / 1024).toFixed(1)}MB)`,
        stats
      );
    },
    [logInfo]
  );

  // 自定义文件验证器
  const customFileValidator = (file: File) => {
    // 自定义文件验证示例
    if (file.name.includes("test")) {
      return { valid: false, message: "不允许包含test的文件名" };
    }
    if (file.size > 500 * 1024 * 1024) {
      // 500MB
      return { valid: false, message: "文件大小不能超过500MB" };
    }
    return { valid: true };
  };

  return (
    <div
      style={{ padding: 16, minHeight: "100vh", backgroundColor: "#f5f5f5" }}
    >
      {contextHolder}

      {/* 调试面板 */}
      <DebugPanel logs={logs} onClearLogs={clearLogs} />

      <Card title="React 文件上传下载组件调试示例" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <div>
            <h3>🎯 功能特性</h3>
            <ul>
              <li>
                📤 <strong>文件上传</strong>:
                支持大文件分片上传、断点续传、秒传检测
              </li>
              <li>
                📥 <strong>文件下载</strong>:
                支持大文件分片下载、断点续传、批量下载
              </li>
              <li>
                🌐 <strong>网络监测</strong>: 智能检测网络状态，自动调整传输策略
              </li>
              <li>
                💾 <strong>存储管理</strong>: 监控本地存储使用情况
              </li>
              <li>
                ⚙️ <strong>高度可配置</strong>: 丰富的配置选项和回调事件
              </li>
              <li>
                🎯 <strong>TypeScript</strong>: 完整的类型支持
              </li>
              <li>
                🐛 <strong>调试面板</strong>: 实时日志记录和调试信息
              </li>
            </ul>
          </div>

          <div>
            <Button
              type="primary"
              onClick={() => {
                clearLogs();
                messageApi.success("已清空调试日志");
              }}
              style={{ marginRight: 8 }}
            >
              清空调试日志
            </Button>
            <Button
              onClick={() => {
                logInfo("system", `当前活动标签: ${activeTab}`, {
                  activeTab,
                  timestamp: new Date().toISOString(),
                });
                logInfo("system", `日志总数: ${logs.length}`, {
                  logCount: logs.length,
                });
                messageApi.info("调试信息已记录到日志");
              }}
            >
              输出调试信息
            </Button>
          </div>
        </Space>
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="card"
        size="large"
        items={[
          {
            key: "upload",
            label: "📤 文件上传",
            children: (
              <Card title="ZustandFileUpload 组件调试">
                <ZustandFileUpload
                  baseURL="http://localhost:3000"
                  uploadApi="/api/file/upload"
                  checkApi="/api/file/instant"
                  chunkSize={1024 * 1024} // 1MB
                  fileConcurrency={2}
                  chunkConcurrency={2}
                  maxRetries={3}
                  maxFileSize={100 * 1024 * 1024} // 100MB
                  allowedFileTypes={[]} // 允许所有类型
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
              </Card>
            ),
          },
          {
            key: "download",
            label: "📥 文件下载",
            children: (
              <Card title="ZustandFileDownload 组件调试">
                <ZustandFileDownload
                  baseURL="http://localhost:3000"
                  listApi="/api/files/list"
                  downloadApi="/api/files/download"
                  chunkSize={2 * 1024 * 1024} // 2MB 分片
                  maxConcurrency={3} // 最大并发数
                  maxRetries={5} // 最大重试次数
                  retryDelay={2000} // 重试延迟 2 秒
                  autoStart={false} // 手动开始下载
                  showProgress={true} // 显示进度
                  showStorageStats={true} // 显示存储统计
                  showNetworkStatus={true} // 显示网络状态
                  onDownloadStart={handleDownloadStart}
                  onDownloadProgress={handleDownloadProgress}
                  onDownloadComplete={handleDownloadComplete}
                  onDownloadError={handleDownloadError}
                  onBatchComplete={handleDownloadBatchComplete}
                  onStorageChange={handleStorageChange}
                />
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};
export default App;
