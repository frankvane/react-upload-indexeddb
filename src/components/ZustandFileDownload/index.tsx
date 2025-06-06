import { FileList, StorageStats } from "./components";
import React, { useEffect } from "react";

import { Space } from "antd";
import { initializeStorage } from "./utils/storage";
import { useStorageManager } from "./hooks";

/**
 * ZustandFileDownload组件
 * 使用Zustand进行状态管理的大文件下载组件
 */
const ZustandFileDownload: React.FC = () => {
  // 只获取初始化所需的方法
  const { getStorageUsage } = useStorageManager();

  // 初始化存储
  useEffect(() => {
    const initStorage = async () => {
      try {
        console.log("初始化存储...");
        await initializeStorage();
        console.log("存储初始化成功");

        // 初始化后获取存储使用情况
        await getStorageUsage();
      } catch (error) {
        console.error("初始化存储失败:", error);
      }
    };

    initStorage();
  }, [getStorageUsage]);

  return (
    <div style={{ padding: "20px" }}>
      <center>
        <h2>大文件下载</h2>
      </center>
      <Space direction="vertical" style={{ width: "100%" }}>
        {/* 存储统计组件 - 直接从store获取数据 */}
        <StorageStats />

        {/* 文件列表组件 - 直接从store获取数据 */}
        <FileList />
      </Space>
    </div>
  );
};

export default ZustandFileDownload;
