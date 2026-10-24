# 组件使用文档（Props / 回调 / 接入示例）

本文面向业务集成方，说明当前项目可复用组件的接入方式、属性说明、回调时机和注意事项。

## 文档职责

- 负责：组件级接入说明（Props、默认值、回调、示例代码、接入建议）。
- 不负责：系统架构设计推导与 API 全量契约细节。

## 1. 组件总览

| 组件                  | 作用                                                 | 典型场景                   |
| --------------------- | ---------------------------------------------------- | -------------------------- |
| `ZustandFileUpload`   | 完整上传组件（分片、重试、自动策略、IndexedDB 恢复） | 上传主页面、后台文件管理页 |
| `ZustandFileDownload` | 下载组件（列表、分片下载、暂停恢复、导出）           | 下载中心、文件管理页       |
| 简化外观（属性组合）  | `uiMode="simple"` / `showStorageStats={false}` 等    | 业务页面快速集成轻量入口   |
| `DebugPanel`          | 前端调试日志面板                                     | 联调阶段、问题排查         |

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
/>;
```

### 2.2 Props 说明

| 属性                  | 类型                                                              | 默认值                        | 说明                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseURL`             | `string`                                                          | `API_BASE_URL`                | API 基础地址                                                                                                                                     |
| `uploadApi`           | `string`                                                          | `API_PATHS.file.upload`       | 分片上传接口                                                                                                                                     |
| `checkApi`            | `string`                                                          | `API_PATHS.file.instant`      | 秒传/分片校验接口                                                                                                                                |
| `mergeApi`            | `string`                                                          | `API_PATHS.file.merge`        | 合并接口；URL 拼接统一走 `joinUrl`，`baseURL` 带尾斜杠不会出现 `//api/`                                                                          |
| `chunkSize`           | `number`                                                          | `1024 * 1024`                 | 分片大小（字节）                                                                                                                                 |
| `fileConcurrency`     | `number`                                                          | `2`                           | 文件级并发                                                                                                                                       |
| `chunkConcurrency`    | `number`                                                          | `2`                           | 分片级并发                                                                                                                                       |
| `maxRetries`          | `number`                                                          | `3`                           | 单分片重试次数                                                                                                                                   |
| `maxFileSize`         | `number`                                                          | `100 * 1024 * 1024`           | 单文件最大大小                                                                                                                                   |
| `allowedFileTypes`    | `string[]`                                                        | `[]`                          | 允许类型（MIME / 后缀）                                                                                                                          |
| `maxFiles`            | `number`                                                          | `100`                         | 单批最大文件数                                                                                                                                   |
| `autoUpload`          | `boolean`                                                         | `true`                        | 选择文件后自动上传                                                                                                                               |
| `autoCleanup`         | `boolean`                                                         | `true`                        | 完成后自动清理本地上传列表项                                                                                                                     |
| `cleanupDelay`        | `number`                                                          | `10`                          | 自动清理倒计时（秒）                                                                                                                             |
| `networkDisplayMode`  | `"tooltip" \| "direct"`                                           | `"tooltip"`                   | 网络与策略信息展示方式                                                                                                                           |
| `uiMode`              | `"full" \| "simple"`                                              | `"full"`                      | `simple` 时只保留选择文件 + 进度列表                                                                                                             |
| `settingsSource`      | `"localStorage" \| "props"`                                       | `"localStorage"`              | 设置来源；`props` 可忽略历史本地设置污染                                                                                                         |
| `authToken`           | `string`                                                          | `undefined`                   | 静态 Bearer Token（适合演示，不建议硬编码）                                                                                                      |
| `getAuthToken`        | `() => string \| undefined \| Promise<string \| undefined>`       | `undefined`                   | 每次上传前动态取 Token（支持刷新）                                                                                                               |
| `getAuthHeaders`      | `() => Record<string, string> \| Promise<Record<string, string>>` | `undefined`                   | 完全自定义请求头（最高优先级）                                                                                                                   |
| `authScheme`          | `string`                                                          | `"Bearer"`                    | Token scheme                                                                                                                                     |
| `withCredentials`     | `boolean`                                                         | `false`                       | 是否以 `credentials:'include'` 发送（携带 Cookie）。默认 `same-origin`；仅跨域 Cookie 鉴权时开启                                                 |
| `customFileValidator` | `(file: File) => { valid: boolean; message?: string }`            | `undefined`                   | 自定义文件校验                                                                                                                                   |
| `customUploadHandler` | `(file, config) => Promise<boolean>`                              | `undefined`                   | 自定义上传处理器（当前版本为预留）                                                                                                               |
| `visibleColumns`      | `UploadColumnKey[]`                                               | `undefined`（显示全部内置列） | 控制上传表格显示的列并决定其顺序；列 key：`index` \| `fileName` \| `fileSize` \| `chunkCount` \| `status` \| `progress` \| `action`（v2.0.4 起） |

### 2.3 回调方法

| 回调               | 签名                                   | 触发时机                                       |
| ------------------ | -------------------------------------- | ---------------------------------------------- |
| `onUploadStart`    | `(files) => void`                      | 调用批量上传前，传入本批待上传文件             |
| `onUploadProgress` | `(file, progress) => void`             | 上传过程中按进度触发                           |
| `onUploadComplete` | `(file, success) => void`              | 单文件上传成功（含秒传）后触发，`success=true` |
| `onUploadError`    | `(file, error) => void`                | 单文件失败后触发                               |
| `onBatchComplete`  | `({ success, failed, total }) => void` | 批次全部结束后触发                             |

### 2.4 行为说明

- 组件会将上传队列、分片进度持久化到 IndexedDB（`upload-indexeddb`）。
- 页面刷新后会尝试恢复中断上传任务；`autoUpload=true` 且网络可用时会自动续传。
- `uiMode="simple"` 时，会隐藏手动上传/清理/重试与高级开关，仅保留简化视图。
- `settingsSource="props"` 适合简化模式，避免被历史 `localStorage` 开关覆盖。

## 3. 简化外观（属性组合，v3 起）

v3 起不再提供 `SimpleUploadList` / `SimpleDownloadList`，精简外观直接在完整组件上通过属性表达，底层引擎完全一致：

```tsx
// 上传：极简 UI + 纯自动模式
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
  uiMode="simple"
  settingsSource="props"
/>

// 下载：仅保留列表 + 核心操作
<ZustandFileDownload
  baseURL={API_BASE_URL}
  listApi={API_PATHS.file.list}
  downloadApi={API_PATHS.file.download}
  showStorageStats={false}
  showNetworkStatus={false}
  showBatchInfo={false}
/>
```

- `uiMode="simple"`：隐藏手动上传/清理/重试与高级开关，工具栏仅保留「选择文件」，选择即自动上传。
- `settingsSource="props"`：网络参数只跟随 props，不被历史 `localStorage` 开关覆盖。
- 下载侧 `showStorageStats` / `showNetworkStatus` / `showBatchInfo` 默认均为 `true`，按需关闭即可。

原先 `SimpleUploadList` 附带的"服务端清单 + 上传弹窗 + 批次结束清理成功项"依赖具体业务接口，属于页面编排逻辑，不在通用库范围内；`src/demo/SimpleUploadDemo.tsx` 保留了一份纯属性示例，业务侧可参照自行组合。

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
/>;
```

### 4.2 Props 说明

| 属性                    | 类型                                                              | 默认值                        | 说明                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `baseURL`               | `string`                                                          | `API_BASE_URL`                | API 基础地址                                                                                                                      |
| `listApi`               | `string`                                                          | `API_PATHS.file.list`         | 列表接口                                                                                                                          |
| `downloadApi`           | `string`                                                          | `API_PATHS.file.download`     | 下载接口                                                                                                                          |
| `chunkSize`             | `number`                                                          | `5 * 1024 * 1024`             | 下载分片大小                                                                                                                      |
| `maxConcurrency`        | `number`                                                          | `3`                           | 最大下载并发                                                                                                                      |
| `maxRetries`            | `number`                                                          | `3`                           | 下载重试次数                                                                                                                      |
| `retryDelay`            | `number`                                                          | `1000`                        | 重试间隔（毫秒）                                                                                                                  |
| `authToken`             | `string`                                                          | `undefined`                   | 静态 Bearer Token（适合演示，不建议硬编码）                                                                                       |
| `getAuthToken`          | `() => string \| undefined \| Promise<string \| undefined>`       | `undefined`                   | 每次开始下载前动态取 Token（支持刷新）                                                                                            |
| `getAuthHeaders`        | `() => Record<string, string> \| Promise<Record<string, string>>` | `undefined`                   | 完全自定义请求头（最高优先级）                                                                                                    |
| `authScheme`            | `string`                                                          | `"Bearer"`                    | Token scheme                                                                                                                      |
| `withCredentials`       | `boolean`                                                         | `false`                       | 分片请求是否以 `credentials:'include'` 发送（携带 Cookie）。默认 `same-origin`；仅跨域 Cookie 鉴权时开启                          |
| `autoStart`             | `boolean`                                                         | `false`                       | 是否自动开始下载                                                                                                                  |
| `showProgress`          | `boolean`                                                         | `true`                        | 是否显示进度                                                                                                                      |
| `showStorageStats`      | `boolean`                                                         | `true`                        | 是否显示存储统计                                                                                                                  |
| `showNetworkStatus`     | `boolean`                                                         | `true`                        | 是否显示网络状态                                                                                                                  |
| `showBatchInfo`         | `boolean`                                                         | `true`                        | 是否显示批次汇总条（活动中/排队中/已完成/批次进度 + 进度条，v2.0.1 起）                                                           |
| `customDownloadHandler` | `(file, config) => Promise<boolean>`                              | `undefined`                   | 自定义下载处理器（当前版本为预留）                                                                                                |
| `customProgressHandler` | `(file, progress) => void`                                        | `undefined`                   | 自定义进度处理器（当前版本为预留）                                                                                                |
| `visibleColumns`        | `DownloadColumnKey[]`                                             | `undefined`（显示全部内置列） | 控制下载表格显示的列并决定其顺序；列 key：`fileName` \| `fileSize` \| `chunks` \| `status` \| `progress` \| `action`（v2.0.4 起） |

### 4.3 回调方法（接口已定义）

| 回调                 | 签名                                   | 当前状态                                     |
| -------------------- | -------------------------------------- | -------------------------------------------- |
| `onDownloadStart`    | `(file) => void`                       | 已定义在 Props；当前实现未在下载主链路触发   |
| `onDownloadProgress` | `(file, progress) => void`             | 已定义在 Props；当前实现未在下载主链路触发   |
| `onDownloadComplete` | `(file, success) => void`              | 已定义在 Props；当前实现未在下载主链路触发   |
| `onDownloadError`    | `(file, error) => void`                | 已定义在 Props；当前实现未在下载主链路触发   |
| `onBatchComplete`    | `({ success, failed, total }) => void` | 已定义在 Props；当前实现未在下载主链路触发   |
| `onStorageChange`    | `(stats) => void`                      | 已定义在 Props；当前实现未在存储更新流程触发 |

说明：以上回调签名已是稳定接口定义，若需要我可以下一步补齐下载链路中的回调实际触发点。

### 4.4 行为说明

- 下载分片与状态会落到 IndexedDB，支持暂停/恢复与刷新后继续。
- 文件列表来自服务端 `/api/file/list`，并合并本地下载状态展示。
- UI/行为类 props（`autoStart`/`showProgress`/`showStorageStats`/`showNetworkStatus`/`showBatchInfo`）在挂载与 props 变化时显式同步进 store（v2.0.1 起）；未显式传入的项保持 store 现值，运行时修改不被重置。

## 5. DebugPanel（辅助）

### 5.1 Props

| 属性          | 类型         | 说明                       |
| ------------- | ------------ | -------------------------- |
| `logs`        | `LogEntry[]` | 日志数组（按业务自行维护） |
| `onClearLogs` | `() => void` | 清空日志回调               |

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

1. 业务集成精简上传时，使用 `uiMode="simple"` + `settingsSource="props"`（见第 3 节）；服务端清单等页面编排逻辑由业务侧自行实现。
2. 若需“始终自动模式”，上传组件请固定 `settingsSource="props"`，避免本地历史开关影响。
3. 若希望以组件回调联动埋点/通知，上传组件可以直接使用；下载组件建议先补齐回调触发点再依赖。

## 7. 分片键与队列 id（v1.1.0 起）

- **分片存储键**（服务端 `file_id`）由客户端生成为 `${md5}_${size}_${chunkSize}`（`src/shared/chunkKey.ts`）。`chunkSize` 会随网络状况在 256KB~8MB 间自适应调整，键中携带 `chunkSize` 使新旧分片方案天然隔离，续传校验不会把另一套分片误判为已传（P1-6）。
- **秒传判定**以 `md5 + size` 为准（服务端 `instantCheck`），因此 `chunkSize` 变化不影响秒传命中。
- **上传队列 id**（本地 IndexedDB 主键）为 `${md5}_${size}_${lastModified}_${随机后缀}`，同内容文件多次选择不再互相覆盖（P1-7）。
- 兼容性：旧版纯 md5 键的请求服务端按兼容逻辑处理；`instantCheck` 检测到复合键与请求的 `size`/`chunk_size` 不一致时，会清空该键下的旧分片结果并提示客户端按新参数重传。

## 8. 鉴权接入

组件不持有任何凭证，鉴权全部通过 props 注入，由消费方决定 Token 来源。上传侧与下载侧共用同一套语义（解析实现在 `src/shared/authHeaders.ts`）。

### 8.1 credentials 默认语义

- 上传 Worker（`fetch`）与下载分片请求**默认 `same-origin`**：同域场景浏览器自动携带 Cookie；跨域 Bearer 头鉴权不会触发 CORS preflight 对 `Access-Control-Allow-Credentials:true` 的强校验。
- 仅当需要**跨域 Cookie** 鉴权时才显式 `withCredentials: true`，此时服务端必须返回 `Access-Control-Allow-Credentials:true` 且 `Access-Control-Allow-Origin` 为具体 Origin（不能是 `*`）。
- 下载侧列表请求走 axios，默认 `withCredentials: false`，语义同上。

### 8.2 组合矩阵

| 场景                | 上传侧（FileUpload）                                                        | 下载侧（FileDownload）                                           | 服务端要求                                            |
| ------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| 跨域 Bearer（推荐） | `getAuthToken` / `authToken` / `getAuthHeaders`，`withCredentials` 保持默认 | 同名 props（分片请求，v1.1.0 起）+ `setDownloadAuth`（列表请求） | 校验 `Authorization` 头；CORS 暴露该头                |
| 同域 Cookie         | 无需额外代码（默认 `same-origin` 自动携带）                                 | 无需额外代码                                                     | 校验 Cookie                                           |
| 跨域 Cookie         | `withCredentials: true`                                                     | `withCredentials: true`                                          | `Access-Control-Allow-Credentials:true` + 具体 Origin |

### 8.3 代码示例

```tsx
import { FileUpload, FileDownload, setDownloadAuth } from "react-upload-indexeddb";

// Bearer（跨域，推荐）：每次请求前取最新 token
<FileUpload baseURL="https://upload.example.com" getAuthToken={async () => readPortalToken()} />
<FileDownload baseURL="https://upload.example.com" getAuthToken={async () => readPortalToken()} />

// 列表请求（axios）的鉴权头需单独注入；传 undefined 清除
setDownloadAuth({ Authorization: `Bearer ${token}` });

// 跨域 Cookie 鉴权时才需要显式开启
<FileUpload baseURL="https://upload.example.com" withCredentials={true} />
<FileDownload baseURL="https://upload.example.com" withCredentials={true} />
```

> 优先级：`getAuthHeaders` > `getAuthToken` > `authToken`；均无时发送无鉴权头的请求。

### 8.4 ⚠️ 安全部署提示

配套的 demo / 参考服务端（`server/`）**鉴权中间件默认关闭**，仅用于本地联调与演示。**生产部署必须自行启用鉴权**：

- 启用 `server/src/middleware/auth.js` 的 Bearer / Cookie 校验（通过环境变量打开）；
- 任何对外暴露的上传/下载接口都应在网关或服务端强制校验身份，否则攻击者可任意上传/下载/读取他人文件；
- 切勿将未鉴权的文件接口直接暴露在公网。

组件层已做到「不持有凭证、纯 props 注入」，但**服务端是否鉴权由部署方负责**——库本身不承诺服务端安全。（server 默认 fail-closed 的变更为待确认项，当前仅做文档提示。）
