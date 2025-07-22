# ZustandFileDownload 组件

基于 Zustand 状态管理的大文件下载组件，支持分片下载、断点续传、网络状态监测等功能。

## 特性

- 🚀 **分片下载**: 支持大文件分片下载，提高下载效率
- 🔄 **断点续传**: 支持下载中断后的断点续传
- 📊 **进度监控**: 实时显示下载进度和速度
- 🌐 **网络监测**: 智能检测网络状态，自动调整下载策略
- 💾 **存储管理**: 监控本地存储使用情况
- ⚙️ **高度可配置**: 支持丰富的配置选项和回调事件
- 🎯 **TypeScript**: 完整的 TypeScript 类型支持

## 基本用法

```tsx
import ZustandFileDownload from './components/ZustandFileDownload';

function App() {
  return (
    <ZustandFileDownload
      baseURL="https://api.example.com"
      listApi="/api/files/list"
      downloadApi="/api/files/download"
    />
  );
}
```

## 配置选项

### API 配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseURL` | `string` | `""` | API 基础 URL |
| `listApi` | `string` | `"/api/files"` | 文件列表 API 路径 |
| `downloadApi` | `string` | `"/api/download"` | 下载 API 路径 |

### 下载参数配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `chunkSize` | `number` | `5242880` | 分片大小（字节），默认 5MB |
| `maxConcurrency` | `number` | `3` | 最大并发下载数 |
| `maxRetries` | `number` | `3` | 最大重试次数 |
| `retryDelay` | `number` | `1000` | 重试延迟时间（毫秒） |

### UI 配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `autoStart` | `boolean` | `false` | 是否自动开始下载 |
| `showProgress` | `boolean` | `true` | 是否显示进度条 |
| `showStorageStats` | `boolean` | `true` | 是否显示存储统计 |
| `showNetworkStatus` | `boolean` | `true` | 是否显示网络状态 |

## 回调事件

### onDownloadStart
下载开始时触发
```tsx
onDownloadStart={(file: DownloadFile) => {
  console.log('下载开始:', file.fileName);
}}
```

### onDownloadProgress
下载进度更新时触发
```tsx
onDownloadProgress={(file: DownloadFile, progress: number) => {
  console.log(`下载进度 ${file.fileName}: ${progress}%`);
}}
```

### onDownloadComplete
下载完成时触发
```tsx
onDownloadComplete={(file: DownloadFile, success: boolean) => {
  if (success) {
    console.log('下载成功:', file.fileName);
  } else {
    console.log('下载失败:', file.fileName);
  }
}}
```

### onDownloadError
下载错误时触发
```tsx
onDownloadError={(file: DownloadFile, error: string) => {
  console.error(`下载错误 ${file.fileName}:`, error);
}}
```

### onBatchComplete
批次下载完成时触发
```tsx
onBatchComplete={(results) => {
  console.log('批次下载完成:', results);
}}
```

### onStorageChange
存储使用情况变化时触发
```tsx
onStorageChange={(stats: StorageStats) => {
  console.log('存储使用情况:', stats);
}}
```

## 高级用法

### 完整配置示例

```tsx
<ZustandFileDownload
  // API 配置
  baseURL="https://api.example.com"
  listApi="/api/files/list"
  downloadApi="/api/files/download"
  
  // 下载参数配置
  chunkSize={2 * 1024 * 1024} // 2MB 分片
  maxConcurrency={5} // 最大并发数
  maxRetries={5} // 最大重试次数
  retryDelay={2000} // 重试延迟 2 秒
  
  // UI 配置
  autoStart={true} // 自动开始下载
  showProgress={true} // 显示进度
  showStorageStats={true} // 显示存储统计
  showNetworkStatus={true} // 显示网络状态
  
  // 回调事件
  onDownloadStart={(file) => console.log('开始下载:', file.fileName)}
  onDownloadProgress={(file, progress) => console.log(`进度: ${progress}%`)}
  onDownloadComplete={(file, success) => console.log('下载完成:', success)}
  onDownloadError={(file, error) => console.error('下载错误:', error)}
  onBatchComplete={(results) => console.log('批次完成:', results)}
  onStorageChange={(stats) => console.log('存储变化:', stats)}
/>
```

## 类型定义

组件使用 TypeScript 编写，提供完整的类型支持。主要类型包括：

- `ZustandFileDownloadProps`: 组件属性接口
- `DownloadFile`: 下载文件接口
- `StorageStats`: 存储统计接口
- `DownloadConfig`: 下载配置接口
- `BatchDownloadInfo`: 批次下载信息接口

## 架构设计

组件采用模块化设计，主要包括：

- **Context**: 配置管理和依赖注入
- **Store**: Zustand 状态管理
- **Hooks**: 业务逻辑封装
- **Components**: UI 组件
- **Workers**: 后台下载处理
- **Utils**: 工具函数

## 注意事项

1. 确保服务端支持 Range 请求以实现分片下载
2. 大文件下载时注意浏览器存储限制
3. 网络状态检测依赖浏览器 API，部分功能可能在某些环境下不可用
4. 建议在生产环境中适当调整并发数和分片大小以优化性能
