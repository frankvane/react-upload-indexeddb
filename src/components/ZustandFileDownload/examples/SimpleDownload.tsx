import React from "react";
import ZustandFileDownload from "../index";

/**
 * 简单的下载组件示例
 * 使用最少的配置选项
 */
const SimpleDownloadExample: React.FC = () => {
  return (
    <div>
      <h1>简单下载组件示例</h1>
      
      <ZustandFileDownload
        baseURL="https://api.example.com"
        listApi="/api/files/list"
        downloadApi="/api/files/download"
      />
    </div>
  );
};

export default SimpleDownloadExample;
