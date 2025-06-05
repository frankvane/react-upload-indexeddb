import {
  Button,
  Card,
  Empty,
  Input,
  List,
  Pagination,
  Space,
  Spin,
  message,
} from "antd";
import {
  DownloadOutlined,
  FilterOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import React, { useEffect, useState } from "react";

import api from "../api.client";
import { useDownloadStore } from "../store/download";
import useFileDownloader from "../hooks/useFileDownloader";

// 文件项类型
interface FileItem {
  id: string;
  fileName: string;
  fileSize: number;
  url: string;
  mimeType?: string;
  metadata?: {
    fileExt?: string;
    thumbnailUrl?: string;
    md5?: string;
    createdAt?: string;
  };
}

// 组件属性
interface FileListPanelProps {
  onAddToDownload?: (fileId: string) => void;
  initialCategory?: string;
  refreshInterval?: number; // 刷新间隔，单位毫秒
}

// 文件大小格式化
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

/**
 * 文件列表面板组件
 * 用于显示可下载的文件列表，支持搜索、分页和添加到下载队列
 */
const FileListPanel: React.FC<FileListPanelProps> = ({
  onAddToDownload,
  initialCategory,
  refreshInterval = 0,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [totalFiles, setTotalFiles] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [search, setSearch] = useState<string>("");
  const [category] = useState<string | undefined>(initialCategory);

  const { downloadFile } = useFileDownloader();
  const { downloadTasks } = useDownloadStore();

  // 加载文件列表
  const loadFiles = async () => {
    try {
      setLoading(true);
      const params = {
        page,
        limit: pageSize,
        search: search || undefined,
        category_id: category || undefined,
      };

      const data = await api.getFileList(params);
      setFiles(
        data.files.map((file: Record<string, any>) => ({
          id: file.id,
          fileName: file.fileName,
          fileSize: file.fileSize,
          url: api.createDownloadUrl(file.id),
          mimeType: file.fileType,
          metadata: {
            fileExt: file.fileExt,
            thumbnailUrl: file.thumbnailUrl,
            md5: file.md5,
            createdAt: file.createdAt,
          },
        }))
      );
      setTotalFiles(data.total);
    } catch (error) {
      console.error("加载文件列表失败:", error);
      message.error("加载文件列表失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  // 初始加载和参数变化时重新加载
  useEffect(() => {
    loadFiles();
  }, [page, pageSize, search, category]);

  // 定时刷新
  useEffect(() => {
    if (refreshInterval > 0) {
      const timer = setInterval(() => {
        loadFiles();
      }, refreshInterval);

      return () => clearInterval(timer);
    }
  }, [refreshInterval, page, pageSize, search, category]);

  // 处理下载单个文件
  const handleDownload = async (file: FileItem) => {
    try {
      // 检查是否已经在下载队列中
      const isAlreadyDownloading = downloadTasks.some(
        (task) =>
          task.url === file.url ||
          (file.metadata?.md5 && task.metadata?.md5 === file.metadata.md5)
      );

      if (isAlreadyDownloading) {
        message.info(`文件 "${file.fileName}" 已在下载队列中`);
        return;
      }

      // 添加到下载队列
      const taskId = await downloadFile(file.url, file.fileName, {
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        metadata: file.metadata,
      });

      if (taskId) {
        message.success(`已添加 "${file.fileName}" 到下载队列`);
        if (onAddToDownload) {
          onAddToDownload(taskId);
        }
      }
    } catch (error) {
      console.error("添加下载任务失败:", error);
      message.error("添加下载任务失败，请稍后重试");
    }
  };

  // 批量下载选中的文件
  const handleBatchDownload = async () => {
    // 这里可以实现批量下载逻辑
    message.info("批量下载功能开发中");
  };

  // 处理搜索
  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1); // 重置到第一页
  };

  // 处理分页变化
  const handlePageChange = (page: number, pageSize?: number) => {
    setPage(page);
    if (pageSize) {
      setPageSize(pageSize);
    }
  };

  return (
    <Card
      title="可下载文件列表"
      extra={
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          onClick={handleBatchDownload}
        >
          批量下载
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Space>
          <Input
            placeholder="搜索文件名"
            prefix={<SearchOutlined />}
            allowClear
            onChange={(e) => handleSearch(e.target.value)}
            style={{ width: 250 }}
          />
          <Button icon={<FilterOutlined />}>筛选</Button>
          <Button onClick={loadFiles} loading={loading}>
            刷新
          </Button>
        </Space>

        <Spin spinning={loading}>
          {files.length > 0 ? (
            <List
              itemLayout="horizontal"
              dataSource={files}
              renderItem={(file) => (
                <List.Item
                  actions={[
                    <Button
                      type="primary"
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => handleDownload(file)}
                    >
                      下载
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      file.metadata?.thumbnailUrl ? (
                        <img
                          src={file.metadata.thumbnailUrl}
                          alt={file.fileName}
                          style={{ width: 48, height: 48, objectFit: "cover" }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            background: "#f0f0f0",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {file.metadata?.fileExt || "?"}
                        </div>
                      )
                    }
                    title={file.fileName}
                    description={`${formatFileSize(file.fileSize)} | ${
                      file.mimeType || "未知类型"
                    }`}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty description="暂无可下载文件" />
          )}

          <div style={{ marginTop: 16, textAlign: "right" }}>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={totalFiles}
              onChange={handlePageChange}
              showSizeChanger
              showQuickJumper
              showTotal={(total) => `共 ${total} 个文件`}
            />
          </div>
        </Spin>
      </Space>
    </Card>
  );
};

export default FileListPanel;
