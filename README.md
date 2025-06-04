# Zustand 迁移计划

## 一、组件功能概述

FileUpload 是一个复杂的文件上传组件，具有以下核心功能：

1. 文件选择与处理
2. 基于 IndexedDB 的文件存储
3. 分片上传与断点续传
4. 秒传检测
5. 网络状态自适应
6. 上传进度显示
7. 批量上传与重试
8. 存储统计

## 二、组件结构分析

### 1. 主组件结构

```
FileUpload/
├── components/          # 子组件
├── hooks/               # 自定义钩子
├── types/               # 类型定义
├── utils/               # 工具函数
├── worker/              # Web Worker
└── index.tsx            # 主组件
```

### 2. 核心数据模型

#### 上传文件模型 (UploadFile)

```typescript
interface UploadFile {
  id: string; // 唯一ID
  fileName: string; // 文件名
  fileSize: number; // 文件大小
  fileType: string; // 文件类型
  lastModified: number; // 最后修改时间
  status: UploadStatus; // 上传状态
  progress: number; // 上传进度 (0-100)
  hash?: string; // 文件哈希值
  chunkSize?: number; // 分片大小
  chunkCount?: number; // 分片总数
  uploadedChunks?: number; // 已上传分片数
  pausedChunks?: number[]; // 暂停时已上传的分片索引
  errorMessage?: string; // 错误信息
  createdAt: number; // 创建时间戳
  order: number; // 上传顺序
  buffer?: ArrayBuffer; // 文件二进制内容
}
```

#### 上传状态枚举 (UploadStatus)

```typescript
enum UploadStatus {
  QUEUED = "queued", // 上传已排队
  QUEUED_FOR_UPLOAD = "queued-for-upload", // 上传已排队等待上传
  CALCULATING = "calculating", // 正在计算
  PREPARING_UPLOAD = "preparing-upload", // 正在准备上传
  UPLOADING = "uploading", // 正在上传
  PAUSED = "paused", // 已暂停
  DONE = "done", // 已完成
  INSTANT = "instant", // 秒传
  ERROR = "error", // 错误
  MERGE_ERROR = "merge-error", // 合并错误
}
```

#### 批次信息模型 (BatchInfo)

```typescript
interface BatchInfo {
  current: number; // 当前已处理数量
  total: number; // 总数量
  queued: number; // 队列中数量
  active: number; // 活动中数量
  completed: number; // 已完成数量
  failed: number; // 失败数量
  retried: number; // 重试次数统计
}
```

### 3. 核心钩子分析

#### useBatchUploader

负责文件批量上传的核心逻辑，包括：

- 并发上传控制
- 上传进度跟踪
- 断点续传
- 重试机制
- 上传取消

参数：

```typescript
interface UseBatchUploaderOptions {
  setProgressMap?: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  refreshFiles?: () => void;
  fileConcurrency?: number; // 并发上传文件数
  chunkConcurrency?: number; // 并发上传分片数
  maxRetries?: number; // 最大重试次数
  timeout?: number; // 请求超时时间（毫秒）
  retryInterval?: number; // 重试间隔时间（毫秒）
}
```

返回值：

```typescript
{
  uploadAll: () => Promise<boolean>,
  batchInfo: BatchInfo | null,
  isUploading: boolean,
  cancelUpload: () => void,
  clearBatchInfo: () => void,
  retryUploadFile: (file: UploadFile) => Promise<{success: boolean, message: string}>,
  retryAllFailedFiles: () => Promise<{success: boolean, message: string, retriedCount: number}>
}
```

#### useFileProcessor

负责文件预处理逻辑，包括：

- 文件读取
- 哈希计算
- 分片准备
- 进度显示

参数：

```typescript
interface UseFileProcessorOptions {
  autoUpload: boolean;
  isNetworkOffline: boolean;
  refreshFiles: () => Promise<void>;
  uploadAllRef: React.MutableRefObject<() => Promise<boolean>>;
  messageApi: MessageInstance;
}
```

返回值：

```typescript
{
  loading: boolean,
  cost: number | null,
  processProgress: ProcessProgress | null,
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void,
  inputRef: React.RefObject<HTMLInputElement>,
  triggerFileInput: () => void
}
```

#### useNetworkType

负责网络状态检测与参数自适应，包括：

- 网络类型检测
- 并发数动态调整
- 分片大小动态调整

返回值：

```typescript
{
  networkType: string,
  fileConcurrency: number,
  chunkConcurrency: number,
  chunkSize: number
}
```

#### useIndexedDBFiles

负责 IndexedDB 文件存储管理，包括：

- 文件列表获取
- 文件刷新

返回值：

```typescript
{
  files: UploadFile[],
  refresh: () => Promise<void>
}
```

#### useFileOperations

负责文件操作逻辑，包括：

- 文件删除
- 文件重试
- 批量清除
- 批量重试

参数：

```typescript
interface UseFileOperationsOptions {
  refreshFiles: () => Promise<void>;
  retryUploadFile: (
    file: UploadFile
  ) => Promise<{ success: boolean; message: string }>;
  retryAllFailedFiles: () => Promise<{
    success: boolean;
    message: string;
    retriedCount: number;
  }>;
  messageApi: MessageInstance;
}
```

返回值：

```typescript
{
  retryingFiles: Record<string, boolean>,
  isRetryingAll: boolean,
  handleDeleteFile: (id: string) => Promise<void>,
  handleRetryUpload: (file: UploadFile) => Promise<void>,
  handleClearList: () => Promise<boolean>,
  handleRetryAllUpload: () => Promise<RetryResult>
}
```

#### useLocalStorageSettings

负责本地设置存储，包括：

- 自动上传设置
- 网络显示模式设置

返回值：

```typescript
{
  autoUpload: boolean,
  setAutoUpload: (value: boolean) => void,
  networkDisplayMode: "tooltip" | "direct",
  setNetworkDisplayMode: (mode: "tooltip" | "direct") => void
}
```

### 4. Web Worker 分析

#### uploadWorker.ts

负责文件上传的后台处理，包括：

- 分片上传
- 秒传检测
- 重试机制
- 进度报告

#### filePrepareWorker.ts

负责文件预处理的后台处理，包括：

- 文件读取
- 哈希计算
- 分片准备

### 5. API 请求分析

上传组件向后端发送以下请求：

1. 秒传检测请求

   - URL: `http://localhost:3000/api/file/instant`
   - 方法: POST
   - 参数:
     ```json
     {
       "file_id": "文件哈希",
       "md5": "文件哈希",
       "name": "文件名",
       "size": "文件大小",
       "total": "分片总数",
       "chunk_md5s": ["分片1哈希", "分片2哈希", ...]
     }
     ```

2. 分片上传请求

   - URL: `http://localhost:3000/api/file/upload`
   - 方法: POST
   - 参数: FormData
     - file_id: 文件哈希
     - index: 分片索引
     - chunk: 分片数据
     - total: 分片总数
     - chunk_md5: 分片哈希

3. 合并请求
   - URL: `http://localhost:3000/api/file/merge`
   - 方法: POST
   - 参数:
     ```json
     {
       "file_id": "文件哈希",
       "md5": "文件哈希",
       "name": "文件名",
       "size": "文件大小",
       "total": "分片总数"
     }
     ```

### 6. IndexedDB 存储字段

使用 localforage 库管理 IndexedDB 存储，配置如下：

```javascript
localforage.config({
  name: "upload-indexeddb",
  storeName: "upload_files",
});
```

存储的主要内容是 UploadFile 对象，以文件 ID(哈希值)为键。

## 三、Zustand 迁移 TODO 列表

### 1. 基础设置

- [x] 创建 src/store 目录
- [x] 安装 zustand 依赖: `npm install zustand`
- [x] 创建基础 store 文件: `src/store/upload.ts`

### 2. 状态定义与基础实现

- [x] 定义 UploadState 接口
- [x] 创建 useUploadStore 基础实现
- [x] 实现基本的状态 setter 方法
- [x] 实现 refreshFiles 方法从 IndexedDB 加载文件

### 3. 网络状态管理

- [x] 迁移 useNetworkType 钩子逻辑
- [x] 实现网络状态检测与参数自适应
- [x] 创建 useNetworkDetection 钩子用于组件中

### 4. 文件处理逻辑

- [x] 迁移 useFileProcessor 钩子逻辑
- [x] 实现 handleFileChange 方法
- [x] 保持 Worker 通信逻辑
- [x] 实现文件预处理与进度跟踪

### 5. 上传逻辑

- [x] 迁移 useBatchUploader 钩子逻辑
- [x] 实现队列初始化与管理
- [x] 实现 uploadAll 方法
- [x] 实现 cancelUpload 方法
- [x] 实现 retryUploadFile 方法
- [x] 实现 retryAllFailedFiles 方法
- [x] 实现上传进度跟踪

### 6. 文件操作逻辑

- [x] 迁移 useFileOperations 钩子逻辑
- [x] 实现 handleDeleteFile 方法
- [x] 实现 handleRetryUpload 方法
- [x] 实现 handleClearList 方法
- [x] 实现 handleRetryAllUpload 方法
- [x] 实现 handleClearUploadedFiles 方法

### 7. 设置与本地存储

- [x] 迁移 useLocalStorageSettings 钩子逻辑
- [x] 实现设置的持久化存储
- [x] 实现设置的加载与初始化
- [x] 实现 setAutoUpload 方法
- [x] 实现 setNetworkDisplayMode 方法

### 8. 组件结构

- [x] 创建 src/components/ZustandFileUpload 目录
- [x] 创建 index.tsx 主组件
- [x] 创建 components 子目录
- [x] 迁移 FileTable 组件
- [x] 迁移 FileUploadActions 组件
- [x] 迁移 BatchInfoDisplay 组件
- [x] 迁移 StorageStatsDrawer 组件
- [x] 迁移 NetworkStatusBadge 组件
- [x] 迁移 PercentDisplay 组件

### 9. 组件集成

- [x] 在主组件中集成所有子组件
- [x] 确保组件间通信正常
- [x] 实现 useEffect 钩子用于初始化和自动上传
- [x] 实现输入引用和文件选择触发

### 10. 测试与优化

- [ ] 测试文件选择功能
- [ ] 测试文件上传功能
- [ ] 测试断点续传功能
- [ ] 测试秒传功能
- [ ] 测试文件删除功能
- [ ] 测试批量操作功能
- [ ] 测试网络状态自适应功能
- [ ] 优化状态更新逻辑
- [ ] 解决潜在的性能问题

### 11. 最终集成

- [ ] 在应用中替换原 FileUpload 组件
- [ ] 确保与原组件功能一致
- [ ] 进行最终测试
- [ ] 完成迁移
