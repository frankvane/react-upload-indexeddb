# ZustandFileUpload 组件文档

## 组件概述

ZustandFileUpload 是一个功能强大的 React 文件上传组件，使用 IndexedDB 和 Web Worker 实现高效的文件处理和上传功能。该组件支持大文件分片上传、断点续传、秒传、自动重试等功能，并提供友好的用户界面展示上传进度和状态信息。

## 主要特性

- **IndexedDB 存储**: 使用浏览器的 IndexedDB 存储文件数据，支持大文件处理
- **Web Worker 处理**: 使用 Web Worker 进行文件处理和上传，避免阻塞主线程
- **分片上传**: 支持大文件分片上传，提高上传成功率
- **断点续传**: 支持上传中断后继续上传
- **秒传功能**: 对于已上传过的文件，支持秒传
- **自动重试**: 上传失败时自动重试，可配置最大重试次数
- **并发控制**: 可配置文件并发数和分片并发数
- **自动清理**: 上传完成后自动清理已上传文件，减少存储占用
- **自定义清理延迟**: 可配置清理延迟时间，并显示倒计时
- **网络状态检测**: 自动检测网络状态，离线时禁止上传
- **批量操作**: 支持批量上传、批量重试等操作
- **状态展示**: 详细展示文件处理和上传状态

## 组件结构

ZustandFileUpload 组件采用模块化设计，主要包含以下部分：

### 核心组件

- **ZustandFileUpload**: 主组件，集成所有功能
- **FileUploadActions**: 文件操作按钮组，包括选择文件、上传、清除等功能
- **BatchInfoDisplay**: 批次信息显示组件，展示上传进度、状态和倒计时
- **FileTable**: 文件列表表格，展示文件详细信息和状态
- **ProcessProgressDisplay**: 处理进度展示组件
- **NetworkStatusBadge**: 网络状态展示组件
- **StorageStatsDrawer**: 存储统计抽屉组件

### 状态管理

- **useUploadStore**: 基于 Zustand 的状态管理，存储组件全局状态

### 核心钩子

- **useBatchUploader**: 处理批量上传逻辑
- **useFileProcessor**: 处理文件预处理逻辑
- **useFileOperations**: 处理文件操作逻辑
- **useNetworkDetection**: 处理网络状态检测

### Web Workers

- **filePrepareWorker**: 处理文件预处理，如计算文件哈希等
- **uploadWorker**: 处理文件上传逻辑

## 使用方法

### 基本使用

```jsx
import React from "react";
import ZustandFileUpload from "./components/ZustandFileUpload";

function App() {
  return (
    <div className="App">
      <h1>文件上传示例</h1>
      <ZustandFileUpload
        baseURL="http://localhost:3000"
        uploadApi="/api/file/upload"
        checkApi="/api/file/instant"
      />
    </div>
  );
}

export default App;
```

### 完整配置示例

```jsx
import React from "react";
import ZustandFileUpload from "./components/ZustandFileUpload";

function App() {
  return (
    <div>
      <h1>文件上传示例</h1>
      <ZustandFileUpload
        // API 配置
        baseURL="http://localhost:3000"
        uploadApi="/api/file/upload"
        checkApi="/api/file/instant"

        // 网络参数配置
        chunkSize={1024 * 1024} // 1MB
        fileConcurrency={2}
        chunkConcurrency={2}
        maxRetries={3}

        // 文件限制配置
        maxFileSize={100 * 1024 * 1024} // 100MB
        allowedFileTypes={['.jpg', '.png', '.pdf']}
        maxFiles={10}

        // UI 配置
        autoUpload={true}
        autoCleanup={true}
        cleanupDelay={10}
        networkDisplayMode="tooltip"

        // 回调事件
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

        // 自定义验证
        customFileValidator={(file) => {
          if (file.name.includes('test')) {
            return { valid: false, message: '不允许包含test的文件名' };
          }
          return { valid: true };
        }}
      />
    </div>
  );
}

export default App;
```

## 配置项

ZustandFileUpload 组件提供多种配置选项，可通过 Zustand Store 进行设置：

| 配置项             | 类型                  | 默认值       | 说明                   |
| ------------------ | --------------------- | ------------ | ---------------------- |
| autoUpload         | boolean               | true         | 是否自动上传文件       |
| autoCleanup        | boolean               | true         | 是否自动清理已上传文件 |
| cleanupDelay       | number                | 10           | 清理延迟时间（秒）     |
| fileConcurrency    | number                | 2            | 文件并发上传数         |
| chunkConcurrency   | number                | 2            | 分片并发上传数         |
| chunkSize          | number                | 1024 \* 1024 | 分片大小（字节）       |
| maxRetries         | number                | 3            | 最大重试次数           |
| networkDisplayMode | "tooltip" \| "direct" | "tooltip"    | 网络状态显示模式       |

## 文件状态

文件在上传过程中会经历以下状态：

| 状态              | 说明               |
| ----------------- | ------------------ |
| QUEUED            | 文件已添加到队列   |
| QUEUED_FOR_UPLOAD | 文件已排队等待上传 |
| CALCULATING       | 正在计算文件哈希   |
| PREPARING_UPLOAD  | 正在准备上传       |
| UPLOADING         | 正在上传           |
| PAUSED            | 已暂停             |
| DONE              | 上传完成           |
| INSTANT           | 秒传完成           |
| ERROR             | 上传出错           |
| MERGE_ERROR       | 合并分片出错       |

## 批次信息

批量上传时，组件会显示以下批次信息：

- **活跃**: 当前正在上传的文件数
- **等待**: 等待上传的文件数
- **完成**: 已完成上传的文件数
- **失败**: 上传失败的文件数
- **重试**: 重试次数
- **批量上传进度**: 当前处理进度（如 1/10）
- **清理倒计时**: 文件清理倒计时（秒）

## 功能流程

### 文件上传流程

1. **选择文件**: 用户选择要上传的文件
2. **文件预处理**: Web Worker 计算文件哈希、分片等
3. **文件存储**: 将文件数据存储到 IndexedDB
4. **上传准备**: 设置上传状态和批次信息
5. **文件上传**: Web Worker 处理文件上传，支持分片上传
6. **上传完成**: 更新文件状态，添加到已完成列表
7. **自动清理**: 延迟清理已上传文件，显示倒计时

### 错误重试流程

1. **上传失败**: 文件上传失败，状态设为 ERROR
2. **手动重试**: 用户点击重试按钮
3. **重试上传**: 重新尝试上传文件
4. **重试限制**: 达到最大重试次数后不再自动重试

### 秒传流程

1. **文件检查**: 上传前检查文件哈希是否已存在
2. **秒传处理**: 若文件已存在，直接标记为 INSTANT 状态
3. **状态更新**: 更新批次信息和进度

### 自动清理流程

1. **上传完成**: 文件上传完成后标记为待清理
2. **倒计时开始**: 开始倒计时，默认 10 秒
3. **倒计时显示**: 在批次信息中显示倒计时
4. **清理执行**: 倒计时结束后清理已上传文件
5. **错误文件保留**: 错误状态的文件不会被清理，以便重试

## 网络处理

组件会自动检测网络状态，并在网络离线时禁止上传操作。网络状态显示包括：

- **网络类型**: 如 wifi、4g 等
- **在线状态**: 在线/离线
- **上传配置**: 分片大小、并发数等

## 存储管理

组件使用 IndexedDB 存储文件数据，提供以下存储管理功能：

- **存储统计**: 显示当前存储使用情况
- **清理记录**: 手动清理已上传文件
- **清空列表**: 清空所有文件记录

## 性能优化

组件采用多种性能优化措施：

- **Web Worker**: 使用 Web Worker 处理耗时操作，避免阻塞主线程
- **分片上传**: 大文件分片上传，提高成功率
- **并发控制**: 控制并发数，避免过多请求
- **缓存优化**: 清除不必要的缓存，减少内存占用
- **UI 优化**: 批量更新 UI，减少重渲染

## 注意事项

1. **浏览器兼容性**: 组件使用 IndexedDB 和 Web Worker，需要浏览器支持
2. **存储限制**: IndexedDB 存储有容量限制，大文件可能受到影响
3. **网络依赖**: 上传功能依赖网络状态，网络不稳定可能影响上传
4. **安全性**: 文件上传需考虑安全性，建议在服务端进行文件验证

## 常见问题

### Q: 为什么上传完成后文件会自动消失？

A: 组件默认开启了自动清理功能，上传完成后会在指定延迟时间（默认 10 秒）后自动清理已上传文件。可以通过设置 `autoCleanup` 为 `false` 或增加 `cleanupDelay` 值来调整此行为。

### Q: 如何处理上传失败的文件？

A: 上传失败的文件会被标记为 ERROR 状态，并保留在列表中。您可以点击单个文件的重试按钮或使用批量重试功能重新上传失败的文件。

### Q: 如何调整上传并发数？

A: 可以通过修改 `fileConcurrency` 和 `chunkConcurrency` 配置项来调整文件并发数和分片并发数。

### Q: 秒传功能如何工作？

A: 秒传功能通过比对文件哈希实现。当上传一个与服务器已存在文件哈希相同的文件时，会直接标记为上传成功，无需实际传输文件内容。

## 扩展和自定义

ZustandFileUpload 组件支持多种扩展和自定义方式：

1. **自定义上传接口**: 修改 uploadWorker 中的上传逻辑
2. **自定义 UI**: 替换或修改组件中的 UI 组件
3. **添加新功能**: 通过扩展 Zustand Store 和钩子添加新功能
4. **自定义配置**: 添加新的配置项以支持更多场景

## 更新日志

### v1.0.0

- 初始版本发布，支持基本的文件上传功能

### v1.1.0

- 添加秒传功能
- 添加断点续传功能
- 优化文件处理逻辑

### v1.2.0

- 添加自动重试功能
- 添加网络状态检测
- 优化 UI 显示

### v1.3.0

- 添加自动清理功能
- 添加批量操作功能
- 添加存储统计功能

### v1.4.0

- 添加清理倒计时显示
- 添加自定义清理延迟设置
- 修复错误文件清理问题
