import { Card, Empty, List, Spin } from "antd";

import { DownloadFile } from "../types";
import { FileListItem } from "./FileListItem";
import React from "react";

interface FileListProps {
  files: DownloadFile[];
  storedFiles?: DownloadFile[];
  fetchingFiles: boolean;
  processingFiles: string[];
  onStartDownload: (file: DownloadFile) => void;
  onPauseDownload: (fileId: string) => void;
  onResumeDownload: (fileId: string) => void;
  onCancelDownload: (fileId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onExportFile: (file: DownloadFile) => void;
  onResetProcessingState?: (fileId: string) => void;
}

/**
 * 文件列表组件
 */
export const FileList: React.FC<FileListProps> = ({
  files,
  fetchingFiles,
  processingFiles,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  onDeleteFile,
  onExportFile,
  onResetProcessingState,
}) => {
  return (
    <Card
      title={
        <span>
          文件列表
          {fetchingFiles && <Spin size="small" style={{ marginLeft: 8 }} />}
        </span>
      }
    >
      <List
        dataSource={files}
        loading={fetchingFiles}
        locale={{ emptyText: <Empty description="暂无文件" /> }}
        renderItem={(file) => (
          <FileListItem
            file={file}
            isProcessing={processingFiles.includes(file.id)}
            onStartDownload={onStartDownload}
            onPauseDownload={onPauseDownload}
            onResumeDownload={onResumeDownload}
            onCancelDownload={onCancelDownload}
            onDeleteFile={onDeleteFile}
            onExportFile={onExportFile}
            onResetProcessingState={onResetProcessingState}
          />
        )}
      />
    </Card>
  );
};
