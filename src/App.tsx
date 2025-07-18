import ZustandFileDownload from "./components/ZustandFileDownload";
import ZustandFileUpload from "./components/ZustandFileUpload";

const App = () => {
  return (
    <div style={{ padding: 16 }}>
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
        cleanupDelay={3}
        networkDisplayMode="tooltip"
        onUploadStart={(files) => {
          console.log('上传开始:', files);
        }}
        onUploadProgress={(file, progress) => {
          console.log(`文件 ${file.fileName} 上传进度: ${progress}%`);
        }}
        onUploadComplete={(file, success) => {
          console.log(`文件 ${file.fileName} 上传${success ? '成功' : '失败'}`);
        }}
        onUploadError={(file, error) => {
          console.error(`文件 ${file.fileName} 上传错误:`, error);
        }}
        onBatchComplete={(results) => {
          console.log('批量上传完成:', results);
        }}
        customFileValidator={(file) => {
          // 自定义文件验证示例
          if (file.name.includes('test')) {
            return { valid: false, message: '不允许包含test的文件名' };
          }
          return { valid: true };
        }}
      />
      <ZustandFileDownload
        baseURL="http://localhost:3000"
        listApi="/api/files/list"
        downloadApi="/api/files/download"
      />
    </div>
  );
};
export default App;
