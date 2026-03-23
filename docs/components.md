# 组件使用文档（Props / 回调 / 接入示例）

本文面向业务集成方，说明当前项目可复用组件的接入方式、属性说明、回调时机和注意事项。

## 文档职责

- 负责：组件级接入说明（Props、默认值、回调、示例代码、接入建议）。
- 不负责：系统架构设计推导与 API 全量契约细节。

## 1. 组件总览

| 组件 | 作用 | 典型场景 |
| --- | --- | --- |
| `ZustandFileUpload` | 完整上传组件（分片、重试、自动策略、IndexedDB 恢复） | 上传主页面、后台文件管理页 |
| `SimpleUploadList` | 简化模式组件（服务器清单 + 上传弹窗） | 业务页面快速集成上传入口 |
| `ZustandFileDownload` | 下载组件（列表、分片下载、暂停恢复、导出） | 下载中心、文件管理页 |
| `DebugPanel` | 前端调试日志面板 | 联调阶段、问题排查 |

## 2. ZustandFileUpload

### 2.1 快速接入

```tsx
import ZustandFileUpload from "./components/ZustandFileUpload";
import { API_BASE_URL, API_PATHS } from "./config/api";

<ZustandFileUpload
  baseURL={API_BASE_URL}
  uploadApi={API_PATHS.file.upload}
  checkApi={API_PATHS.file.instant}
  chunkSize={1024 * 1024}
  fileConcurrency={2}
  chunkConcurrency={2}
  maxRetries={3}
  maxFileSize={100 * 1024 * 1024}
  maxFiles={10}
  autoUpload
  autoCleanup
  cleanupDelay={5}
  networkDisplayMode="tooltip"
  onUploadComplete={(file, success) => {
    console.log(file.fileName, success);
  }}
/>
```

### 2.2 Props 说明

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `baseURL` | `string` | `API_BASE_URL` | API 基础地址 |
| `uploadApi` | `string` | `API_PATHS.file.upload` | 分片上传接口 |
| `checkApi` | `string` | `API_PATHS.file.instant` | 秒传/分片校验接口 |
| `chunkSize` | `number` | `1024 * 1024` | 分片大小（字节） |
| `fileConcurrency` | `number` | `2` | 文件级并发 |
| `chunkConcurrency` | `number` | `2` | 分片级并发 |
| `maxRetries` | `number` | `3` | 单分片重试次数 |
| `maxFileSize` | `number` | `100 * 1024 * 1024` | 单文件最大大小 |
| `allowedFileTypes` | `string[]` | `[]` | 允许类型（MIME / 后缀） |
| `maxFiles` | `number` | `100` | 单批最大文件数 |
| `autoUpload` | `boolean` | `true` | 选择文件后自动上传 |
| `autoCleanup` | `boolean` | `true` | 完成后自动清理本地上传列表项 |
| `cleanupDelay` | `number` | `10` | 自动清理倒计时（秒） |
| `networkDisplayMode` | `"tooltip" \| "direct"` | `"tooltip"` | 网络与策略信息展示方式 |
| `uiMode` | `"full" \| "simple"` | `"full"` | `simple` 时只保留选择文件 + 进度列表 |
| `settingsSource` | `"localStorage" \| "props"` | `"localStorage"` | 设置来源；`props` 可忽略历史本地设置污染 |
| `customFileValidator` | `(file: File) => { valid: boolean; message?: string }` | `undefined` | 自定义文件校验 |
| `customUploadHandler` | `(file, config) => Promise<boolean>` | `undefined` | 自定义上传处理器（当前版本为预留） |

### 2.3 回调方法

| 回调 | 签名 | 触发时机 |
| --- | --- | --- |
| `onUploadStart` | `(files) => void` | 调用批量上传前，传入本批待上传文件 |
| `onUploadProgress` | `(file, progress) => void` | 上传过程中按进度触发 |
| `onUploadComplete` | `(file, success) => void` | 单文件上传成功（含秒传）后触发，`success=true` |
| `onUploadError` | `(file, error) => void` | 单文件失败后触发 |
| `onBatchComplete` | `({ success, failed, total }) => void` | 批次全部结束后触发 |

### 2.4 行为说明

- 组件会将上传队列、分片进度持久化到 IndexedDB（`upload-indexeddb`）。
- 页面刷新后会尝试恢复中断上传任务；`autoUpload=true` 且网络可用时会自动续传。
- `uiMode="simple"` 时，会隐藏手动上传/清理/重试与高级开关，仅保留简化视图。
- `settingsSource="props"` 适合简化模式，避免被历史 `localStorage` 开关覆盖。

## 3. SimpleUploadList

### 3.1 快速接入

```tsx
import SimpleUploadList from "./components/SimpleUploadList";
import { API_BASE_URL, API_PATHS } from "./config/api";

<SimpleUploadList
  baseURL={API_BASE_URL}
  uploadApi={API_PATHS.file.upload}
  checkApi={API_PATHS.file.instant}
  listApi={API_PATHS.file.list}
  onServerListChange={(files) => {
    console.log("latest list:", files);
  }}
/>
```

### 3.2 Props 说明

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `baseURL` | `string` | `API_BASE_URL` | API 基础地址 |
| `uploadApi` | `string` | `API_PATHS.file.upload` | 上传接口 |
| `checkApi` | `string` | `API_PATHS.file.instant` | 秒传校验接口 |
| `listApi` | `string` | `API_PATHS.file.list` | 服务端清单接口 |
| `onServerListChange` | `(files: SimpleServerFile[]) => void` | `undefined` | 清单刷新成功后回调最新列表 |

### 3.3 内置固定策略（不可视化配置）

`SimpleUploadList` 内部会以固定参数挂载 `ZustandFileUpload`：

- `chunkSize=1MB`
- `fileConcurrency=2`
- `chunkConcurrency=2`
- `maxRetries=3`
- `maxFileSize=100MB`
- `maxFiles=10`
- `autoUpload=true`
- `autoCleanup=true`
- `cleanupDelay=5`
- `networkDisplayMode="tooltip"`
- `uiMode="simple"`
- `settingsSource="props"`

### 3.4 回调与数据流

- 首次挂载：自动请求服务端清单。
- 单文件上传成功：立即触发清单刷新（串行单飞，避免并发刷新乱序）。
- 每次刷新成功：调用 `onServerListChange(latestFiles)`。
- 批次结束：自动关闭上传弹窗，并清理该批次本地上传列表项。

`onServerListChange` 的 `SimpleServerFile` 结构：

```ts
{
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileExt?: string;
  thumbnailUrl?: string | null;
  md5?: string;
  createdAt?: string | number;
}
```

## 4. ZustandFileDownload

### 4.1 快速接入

```tsx
import ZustandFileDownload from "./components/ZustandFileDownload";
import { API_BASE_URL, API_PATHS } from "./config/api";

<ZustandFileDownload
  baseURL={API_BASE_URL}
  listApi={API_PATHS.file.list}
  downloadApi={API_PATHS.file.download}
  chunkSize={2 * 1024 * 1024}
  maxConcurrency={3}
  maxRetries={5}
  retryDelay={2000}
  autoStart={false}
  showProgress
  showStorageStats
  showNetworkStatus
/>
```

### 4.2 Props 说明

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `baseURL` | `string` | `API_BASE_URL` | API 基础地址 |
| `listApi` | `string` | `API_PATHS.file.list` | 列表接口 |
| `downloadApi` | `string` | `API_PATHS.file.download` | 下载接口 |
| `chunkSize` | `number` | `5 * 1024 * 1024` | 下载分片大小 |
| `maxConcurrency` | `number` | `3` | 最大下载并发 |
| `maxRetries` | `number` | `3` | 下载重试次数 |
| `retryDelay` | `number` | `1000` | 重试间隔（毫秒） |
| `autoStart` | `boolean` | `false` | 是否自动开始下载 |
| `showProgress` | `boolean` | `true` | 是否显示进度 |
| `showStorageStats` | `boolean` | `true` | 是否显示存储统计 |
| `showNetworkStatus` | `boolean` | `true` | 是否显示网络状态 |
| `customDownloadHandler` | `(file, config) => Promise<boolean>` | `undefined` | 自定义下载处理器（当前版本为预留） |
| `customProgressHandler` | `(file, progress) => void` | `undefined` | 自定义进度处理器（当前版本为预留） |

### 4.3 回调方法（接口已定义）

| 回调 | 签名 | 当前状态 |
| --- | --- | --- |
| `onDownloadStart` | `(file) => void` | 已定义在 Props；当前实现未在下载主链路触发 |
| `onDownloadProgress` | `(file, progress) => void` | 已定义在 Props；当前实现未在下载主链路触发 |
| `onDownloadComplete` | `(file, success) => void` | 已定义在 Props；当前实现未在下载主链路触发 |
| `onDownloadError` | `(file, error) => void` | 已定义在 Props；当前实现未在下载主链路触发 |
| `onBatchComplete` | `({ success, failed, total }) => void` | 已定义在 Props；当前实现未在下载主链路触发 |
| `onStorageChange` | `(stats) => void` | 已定义在 Props；当前实现未在存储更新流程触发 |

说明：以上回调签名已是稳定接口定义，若需要我可以下一步补齐下载链路中的回调实际触发点。

### 4.4 行为说明

- 下载分片与状态会落到 IndexedDB，支持暂停/恢复与刷新后继续。
- 文件列表来自服务端 `/api/file/list`，并合并本地下载状态展示。
- 下载配置生效优先级为 `store(含持久化) > props`；若你发现传入 props 未生效，请先检查本地持久化配置。

## 5. DebugPanel（辅助）

### 5.1 Props

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `logs` | `LogEntry[]` | 日志数组（按业务自行维护） |
| `onClearLogs` | `() => void` | 清空日志回调 |

### 5.2 LogEntry 结构

```ts
{
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  category: "upload" | "download" | "network" | "storage" | "system";
  message: string;
  data?: unknown;
}
```

## 6. 常见接入建议

1. 业务集成简化上传时，优先使用 `SimpleUploadList`，并监听 `onServerListChange` 驱动外层列表刷新。
2. 若需“始终自动模式”，上传组件请固定 `settingsSource="props"`，避免本地历史开关影响。
3. 若希望以组件回调联动埋点/通知，上传组件可以直接使用；下载组件建议先补齐回调触发点再依赖。
