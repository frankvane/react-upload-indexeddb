import { Card, Empty, List, Spin } from "antd";

import { FileListItem } from "./FileListItem";
import React from "react";
import { useDownloadFiles } from "../hooks/useDownloadFiles";
import { useFileDownloader } from "../hooks/useFileDownloader";

/**
 * 文件列表组件
 */
export const FileList: React.FC = () => {
  // 直接从store获取状态和方法
  const { files, fetchingFiles } = useDownloadFiles();
  const {
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteFile,
    exportFile,
    processingFiles,
    resetProcessingState,
  } = useFileDownloader();

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
            onStartDownload={startDownload}
            onPauseDownload={pauseDownload}
            onResumeDownload={resumeDownload}
            onCancelDownload={cancelDownload}
            onDeleteFile={deleteFile}
            onExportFile={exportFile}
            onResetProcessingState={resetProcessingState}
          />
        )}
      />
    </Card>
  );
};
