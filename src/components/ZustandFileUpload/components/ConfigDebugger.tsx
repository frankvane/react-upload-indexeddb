import React from "react";
import { useUploadContext } from "../context/UploadContext";
import { useUploadStore } from "../store/upload";

/**
 * 配置调试组件 - 用于验证配置是否正确传递
 */
const ConfigDebugger: React.FC = () => {
  const contextConfig = useUploadContext();
  const storeConfig = useUploadStore((state) => ({
    autoUpload: state.autoUpload,
    autoCleanup: state.autoCleanup,
    cleanupDelay: state.cleanupDelay,
    networkDisplayMode: state.networkDisplayMode,
    chunkSize: state.chunkSize,
    fileConcurrency: state.fileConcurrency,
    chunkConcurrency: state.chunkConcurrency,
    maxRetries: state.maxRetries,
  }));

  return (
    <div style={{ 
      padding: '10px', 
      margin: '10px 0', 
      border: '1px solid #ccc', 
      borderRadius: '4px',
      backgroundColor: '#f9f9f9',
      fontSize: '12px'
    }}>
      <h4>配置调试信息</h4>
      <div style={{ display: 'flex', gap: '20px' }}>
        <div>
          <strong>Context 配置:</strong>
          <pre>{JSON.stringify({
            cleanupDelay: contextConfig.cleanupDelay,
            autoUpload: contextConfig.autoUpload,
            autoCleanup: contextConfig.autoCleanup,
            networkDisplayMode: contextConfig.networkDisplayMode,
            chunkSize: contextConfig.chunkSize,
            fileConcurrency: contextConfig.fileConcurrency,
            chunkConcurrency: contextConfig.chunkConcurrency,
            maxRetries: contextConfig.maxRetries,
          }, null, 2)}</pre>
        </div>
        <div>
          <strong>Store 配置:</strong>
          <pre>{JSON.stringify(storeConfig, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
};

export default ConfigDebugger;
