# ZustandFileDownload

一个基于 React 和 Zustand 的超大文件下载组件，支持 2GB 以上文件的高效下载、断点续传和分片管理。

## 功能特点

- **超大文件支持**：专为 2GB 以上的大文件下载设计
- **分片下载**：自动将大文件分割为小分片并行下载
- **断点续传**：支持下载中断后从断点处继续下载
- **并发控制**：智能控制并发分片数量，优化下载性能
- **网络自适应**：根据网络状况自动调整下载策略
- **进度监控**：精确显示下载进度、速度和剩余时间
- **批量下载**：支持多文件队列下载和管理
- **存储管理**：智能管理本地存储空间，防止存储溢出
- **文件合并**：高效合并分片，生成完整文件
- **离线支持**：网络中断时自动保存状态，网络恢复后自动继续

## 安装

```bash
npm install zustand-file-download
# 或
yarn add zustand-file-download
```

## 基本使用

```jsx
import React from "react";
import { ZustandFileDownload } from "zustand-file-download";

const App = () => {
  // 基本配置
  const config = {
    chunkSize: 10 * 1024 * 1024, // 10MB分片
    maxConcurrentDownloads: 3, // 最大并发下载数
    maxConcurrentChunks: 5, // 每个文件最大并发分片数
    autoStart: true, // 自动开始下载
    storageQuota: 1024 * 1024 * 1024, // 1GB存储配额
    retryTimes: 3, // 失败重试次数
    retryDelay: 1000, // 重试延迟(ms)
  };

  // 下载完成回调
  const onDownloadComplete = (file) => {
    console.log(`文件 ${file.name} 下载完成!`);
  };

  return (
    <div className="app">
      <h1>文件下载示例</h1>
      <ZustandFileDownload
        config={config}
        onComplete={onDownloadComplete}
        onError={(error) => console.error("下载错误:", error)}
        onProgress={(progress) => console.log("总进度:", progress)}
      />
    </div>
  );
};

export default App;
```

## 高级用法

### 自定义下载按钮

```jsx
import { useDownloadStore } from "zustand-file-download";

const DownloadButton = ({ fileUrl, fileName, fileSize }) => {
  const { addDownloadTask, startDownload } = useDownloadStore();

  const handleDownload = async () => {
    // 添加下载任务
    const taskId = await addDownloadTask({
      url: fileUrl,
      fileName: fileName,
      fileSize: fileSize,
      priority: 1, // 优先级，数字越小优先级越高
    });

    // 开始下载
    startDownload(taskId);
  };

  return <button onClick={handleDownload}>下载 {fileName}</button>;
};
```

### 批量下载管理

```jsx
import { useDownloadStore } from "zustand-file-download";

const BatchDownloader = ({ files }) => {
  const {
    addDownloadTask,
    startBatchDownload,
    pauseAllDownloads,
    resumeAllDownloads,
  } = useDownloadStore();

  const handleBatchDownload = async () => {
    // 添加多个下载任务
    const taskIds = await Promise.all(
      files.map((file) =>
        addDownloadTask({
          url: file.url,
          fileName: file.name,
          fileSize: file.size,
        })
      )
    );

    // 开始批量下载
    startBatchDownload(taskIds);
  };

  return (
    <div>
      <button onClick={handleBatchDownload}>
        批量下载 ({files.length}个文件)
      </button>
      <button onClick={pauseAllDownloads}>全部暂停</button>
      <button onClick={resumeAllDownloads}>全部继续</button>
    </div>
  );
};
```

### 监听下载状态

```jsx
import { useDownloadStore } from "zustand-file-download";

const DownloadMonitor = () => {
  // 获取下载状态
  const {
    downloadTasks,
    activeDownloads,
    completedDownloads,
    failedDownloads,
    totalProgress,
    isNetworkOffline,
  } = useDownloadStore();

  return (
    <div className="download-monitor">
      <h3>下载状态监控</h3>
      <div>总进度: {totalProgress.toFixed(2)}%</div>
      <div>活跃下载: {activeDownloads}</div>
      <div>已完成: {completedDownloads}</div>
      <div>失败: {failedDownloads}</div>
      <div>网络状态: {isNetworkOffline ? "离线" : "在线"}</div>

      <h4>任务列表:</h4>
      <ul>
        {downloadTasks.map((task) => (
          <li key={task.id}>
            {task.fileName} - {task.status} - {task.progress.toFixed(2)}%
          </li>
        ))}
      </ul>
    </div>
  );
};
```

## 自动加载文件列表

组件支持自动从后端 API 获取文件列表，有两种方式：

### 1. 显示文件列表面板

将 `showFileList` 属性设置为 `true` 可以显示文件列表面板，用户可以浏览可下载的文件并手动添加到下载队列：

```jsx
<ZustandFileDownload
  showFileList={true}
  config={config}
  onComplete={onDownloadComplete}
/>
```

### 2. 自动加载文件列表

如果你希望组件初始化时自动从后端 API 获取文件列表，可以设置 `autoLoadFiles` 属性：

```jsx
<ZustandFileDownload
  autoLoadFiles={true}
  config={config}
  onComplete={onDownloadComplete}
/>
```

当 `autoLoadFiles` 设置为 `true` 时，组件会在初始化时调用 API 获取文件列表，但默认不会自动添加到下载队列。你可以修改 `index.tsx` 中的代码，取消注释以启用自动添加到队列。

### 3. 使用 useAutoDownload 钩子

除了在组件中设置属性外，还可以使用`useAutoDownload`钩子灵活地处理文件加载和下载逻辑：

```jsx
import { useAutoDownload } from "./components/ZustandFileDownload";

const DownloadManager = () => {
  // 使用钩子获取文件并自动下载
  const {
    files, // 可下载的文件列表
    loading, // 是否正在加载
    error, // 错误信息
    loadFiles, // 手动加载文件列表方法
    downloadAll, // 下载所有文件方法
    downloadOne, // 下载单个文件方法
  } = useAutoDownload({
    autoLoad: true, // 自动加载文件列表
    autoDownload: false, // 不自动下载
    interval: 60000, // 每分钟刷新一次
    filter: (file) => file.fileSize < 100000000, // 只加载小于100MB的文件
    onLoaded: (files) => console.log(`已加载 ${files.length} 个文件`),
    onError: (error) => console.error("加载失败", error),
  });

  return (
    <div>
      <h2>可下载文件 ({files.length})</h2>
      {loading && <p>加载中...</p>}
      {error && <p>错误: {error.message}</p>}

      <button onClick={loadFiles}>刷新文件列表</button>
      <button onClick={downloadAll}>下载全部文件</button>

      <ul>
        {files.map((file) => (
          <li key={file.id}>
            {file.fileName} ({file.fileSize} bytes)
            <button onClick={() => downloadOne(file.id)}>下载</button>
          </li>
        ))}
      </ul>

      {/* 显示下载管理器，但不显示文件列表面板 */}
      <ZustandFileDownload showFileList={false} />
    </div>
  );
};
```

## 技术实现

### 核心技术

1. **分片下载**：使用 HTTP Range 请求实现文件分片下载
2. **Web Workers**：利用 Web Worker 在后台线程处理下载和合并操作
3. **IndexedDB**：存储下载元数据和小文件分片
4. **FileSystem API**：处理大文件分片的存储和合并
5. **Zustand**：高效的状态管理
6. **Streams API**：使用流式处理减少内存占用

### 分片下载算法

ZustandFileDownload 采用自适应分片算法，根据文件大小和网络状况动态调整分片大小：

1. 对于小于 100MB 的文件，使用固定分片大小（默认 5MB）
2. 对于 100MB-1GB 的文件，使用中等分片大小（默认 10MB）
3. 对于大于 1GB 的文件，使用较大分片大小（默认 20MB）
4. 根据网络速度动态调整分片大小和并发数

### 断点续传实现

1. 每个分片下载时，记录其起始位置和已下载字节数
2. 下载中断时，保存所有分片的下载状态到 IndexedDB
3. 恢复下载时，读取断点信息，仅下载未完成的部分
4. 使用 ETag 和 Last-Modified 确保文件未发生变化

### 存储策略

1. 小分片（<5MB）：存储在 IndexedDB 中
2. 大分片（>5MB）：存储在 FileSystem API 中
3. 元数据：存储在 IndexedDB 中
4. 配置信息：存储在 LocalStorage 中
5. 完整文件：通过 FileSystem API 或浏览器下载 API 保存

## API 参考

### 组件属性

| 属性       | 类型     | 默认值  | 描述                      |
| ---------- | -------- | ------- | ------------------------- |
| config     | Object   | {}      | 下载配置对象              |
| onComplete | Function | null    | 下载完成回调函数          |
| onError    | Function | null    | 错误处理回调函数          |
| onProgress | Function | null    | 进度更新回调函数          |
| className  | String   | ''      | 自定义 CSS 类名           |
| style      | Object   | {}      | 自定义内联样式            |
| showUI     | Boolean  | true    | 是否显示内置 UI           |
| theme      | String   | 'light' | 主题，可选'light'或'dark' |

### 配置选项

| 选项                   | 类型    | 默认值     | 描述                     |
| ---------------------- | ------- | ---------- | ------------------------ |
| chunkSize              | Number  | 5242880    | 默认分片大小(字节)       |
| maxConcurrentDownloads | Number  | 3          | 最大并发下载文件数       |
| maxConcurrentChunks    | Number  | 5          | 每个文件最大并发分片数   |
| autoStart              | Boolean | false      | 是否自动开始下载         |
| storageQuota           | Number  | 1073741824 | 存储配额(字节)           |
| retryTimes             | Number  | 3          | 失败重试次数             |
| retryDelay             | Number  | 1000       | 重试延迟(毫秒)           |
| autoCleanup            | Boolean | true       | 是否自动清理已完成的下载 |
| cleanupDelay           | Number  | 3600000    | 自动清理延迟(毫秒)       |
| useFileSystemAPI       | Boolean | true       | 是否使用 FileSystem API  |
| validateChunks         | Boolean | true       | 是否验证分片完整性       |
| networkAdaptive        | Boolean | true       | 是否启用网络自适应       |

### Hook API

#### useDownloadStore

```javascript
const {
  // 状态
  downloadTasks, // 所有下载任务
  activeDownloads, // 活跃下载数量
  completedDownloads, // 已完成下载数量
  failedDownloads, // 失败下载数量
  pausedDownloads, // 暂停下载数量
  totalProgress, // 总体进度(0-100)
  isNetworkOffline, // 网络是否离线
  networkType, // 网络类型

  // 操作方法
  addDownloadTask, // 添加下载任务
  removeDownloadTask, // 移除下载任务
  startDownload, // 开始单个下载
  pauseDownload, // 暂停单个下载
  resumeDownload, // 恢复单个下载
  cancelDownload, // 取消单个下载
  retryDownload, // 重试单个下载
  startBatchDownload, // 开始批量下载
  pauseAllDownloads, // 暂停所有下载
  resumeAllDownloads, // 恢复所有下载
  cancelAllDownloads, // 取消所有下载
  clearCompletedDownloads, // 清除已完成下载

  // 配置
  getConfig, // 获取当前配置
  updateConfig, // 更新配置

  // 存储管理
  getStorageUsage, // 获取存储使用情况
  cleanupStorage, // 清理存储
} = useDownloadStore();
```

#### useBatchDownloader

```javascript
const {
  downloadAll, // 下载所有任务
  cancelDownload, // 取消下载
  retryDownload, // 重试下载
  retryAllFailedDownloads, // 重试所有失败的下载
  clearBatchInfo, // 清除批次信息
  forceCleanup, // 强制清理
} = useBatchDownloader();
```

#### useFileDownloader

```javascript
const {
  prepareDownload, // 准备下载
  startChunkedDownload, // 开始分片下载
  pauseDownload, // 暂停下载
  resumeDownload, // 恢复下载
  mergeChunks, // 合并分片
  validateDownload, // 验证下载
} = useFileDownloader();
```

## 浏览器兼容性

ZustandFileDownload 支持以下现代浏览器：

- Chrome 76+
- Firefox 69+
- Safari 14.1+
- Edge 79+

注意：某些高级功能（如 FileSystem API）可能在部分浏览器中不可用，组件会自动降级使用替代方案。

## 许可证

MIT
