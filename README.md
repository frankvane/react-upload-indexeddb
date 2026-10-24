# react-upload-indexeddb

[![npm version](https://img.shields.io/npm/v/react-upload-indexeddb.svg)](https://www.npmjs.com/package/react-upload-indexeddb)
[![license](https://img.shields.io/npm/l/react-upload-indexeddb.svg)](https://github.com/frankvane/react-upload-indexeddb/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/react-upload-indexeddb.svg)](https://www.npmjs.com/package/react-upload-indexeddb)

基于 **IndexedDB + 分片传输** 的大文件上传/下载 React 组件库：断点续传、秒传、刷新续传、Web Worker 多线程预处理与分片 IO、自动网络策略引擎，支持 Bearer Token / 同域 Cookie 鉴权注入。

![上传模式](https://raw.githubusercontent.com/frankvane/react-upload-indexeddb/main/docs/assets/readme/mode-upload.png)

## 特性

- **断点续传 / 秒传 / 刷新续传**：分片级进度持久化（IndexedDB），刷新或重开后已传分片自动跳过；服务端秒传检查命中即 0 流量完成
- **流式分片读取**：文件字节按分片惰性 `slice()`，内存峰值 = `chunkSize × 并发`，与文件大小解耦（2GB 文件也不会占满内存）
- **Web Worker 多线程**：哈希计算、分片、上传 IO 全部在 Worker 中执行，不阻塞主线程渲染
- **自动策略引擎**：检测 online/rtt/downlink，动态计算分片大小与文件/分片两级并发度
- **鉴权注入**：`getAuthToken` / `getAuthHeaders` / `withCredentials` props 注入，组件不持有任何凭证；默认 `same-origin`，跨域 Bearer 不触发 CORS credentials 校验
- **零 UI 依赖**：内置极简 UI 套件（`rui-` 前缀 + 独立 `style.css`），**不需要 antd**；运行时依赖仅 `axios` / `localforage` / `spark-md5`
- **按需分包**：`react-upload-indexeddb/upload`、`/download`、`/simple` 子路径入口，只引上传不会带入下载引擎
- **简化组件**：`SimpleUploadList` / `SimpleDownloadList` 预配置精简外观，一行代码接入；完整组件全部属性可配，可自由在"完整 ↔ 简化"间切换

## 安装

```bash
npm install react-upload-indexeddb
```

peer 依赖（消费方自备）：`react@^18 || ^19`、`react-dom@^18 || ^19`、`zustand@^5`。

**样式必须引入**（否则组件无样式）：

```ts
import "react-upload-indexeddb/dist/style.css";
```

## 快速上手

### 完整上传

```tsx
import { ZustandFileUpload } from "react-upload-indexeddb";

<ZustandFileUpload
  baseURL="https://your-api.com"
  uploadApi="/api/file/upload"
  checkApi="/api/file/instant"
  chunkSize={5 * 1024 * 1024}   // 5MB 分片
  fileConcurrency={2}            // 同时上传文件数
  chunkConcurrency={3}           // 单文件分片并发
  autoUpload={true}
  autoCleanup={true}
  getAuthToken={async () => await readPortalToken()}  // 鉴权注入
/>
```

### 完整下载

```tsx
import { ZustandFileDownload } from "react-upload-indexeddb";

<ZustandFileDownload
  baseURL="https://your-api.com"
  listApi="/api/file/list"
  downloadApi="/api/file/download"
  chunkSize={2 * 1024 * 1024}
  maxConcurrency={3}
  autoStart={false}
  showStorageStats={true}   // 存储统计
  showNetworkStatus={true}  // 网络状态徽章
  showBatchInfo={true}      // 批次汇总条（活动中/排队中/已完成/进度）
/>
```

### 简化组件（快速应用）

面向集成场景的最小外观，底层是同一套分片引擎：

```tsx
import { SimpleUploadList, SimpleDownloadList } from "react-upload-indexeddb";

<SimpleUploadList baseURL="https://your-api.com" />
<SimpleDownloadList baseURL="https://your-api.com" autoStart={false} />
```

简化组件本质是"预置了一组默认属性的完整组件"——传任意属性即可覆盖默认值，例如
`<SimpleDownloadList showBatchInfo />` 找回批次汇总条，或
`<ZustandFileDownload showStorageStats={false} showNetworkStatus={false} showBatchInfo={false} />`
让完整版呈现简化外观。

> 简化上传组件为**纯自动模式**：选择文件即自动上传、失败自动重试，工具栏只提供「选择文件」，不暴露手动上传/重试按钮（页面刷新后残留的排队行会在挂载时转为"请重新选择文件"的失败态，见 CHANGELOG 2.0.5 / 2.0.6）。

### 按需引入（真·分包）

```ts
// 只引上传链路（不打包下载引擎）
import { ZustandFileUpload } from "react-upload-indexeddb/upload";

// 只引下载链路
import { ZustandFileDownload } from "react-upload-indexeddb/download";

// 只引两个简化组件
import { SimpleUploadList, SimpleDownloadList } from "react-upload-indexeddb/simple";
```

## 组件属性概览

| 组件 | 用途 | 常用属性 |
| --- | --- | --- |
| `ZustandFileUpload` | 完整上传 | `baseURL` `uploadApi` `checkApi` `chunkSize` `fileConcurrency` `chunkConcurrency` `autoUpload` `autoCleanup` `hashMode` `maxFileSize` `allowedFileTypes` `visibleColumns` |
| `ZustandFileDownload` | 完整下载 | `baseURL` `listApi` `downloadApi` `chunkSize` `maxConcurrency` `autoStart` `showProgress` `showStorageStats` `showNetworkStatus` `showBatchInfo` `visibleColumns` |
| `SimpleUploadList` | 简化上传 | 同 `ZustandFileUpload`（默认 `autoUpload=true`、极简 UI） |
| `SimpleDownloadList` | 简化下载 | 同 `ZustandFileDownload`（默认 `showStorageStats/showNetworkStatus/showBatchInfo=false`） |

> 列控制 / 面板开关均**不改变底层引擎**，只影响展示。详见下方「自定义表格列」与「简化外观」。

### 自定义表格列（visibleColumns）

上传 `ZustandFileUpload` 与下载 `ZustandFileDownload` 支持 `visibleColumns`：传入列 key 数组即可**控制显示哪些列，并按数组顺序排列**；不传则显示全部内置列。隐藏「操作」列后表格内不再提供暂停/继续/重试/删除按钮，由消费方自行提供控制。

```tsx
import {
  ZustandFileUpload,
  ZustandFileDownload,
  type UploadColumnKey,
  type DownloadColumnKey,
} from "react-upload-indexeddb";

// 上传：只显示 文件名 / 状态 / 进度 / 操作，按此顺序
<ZustandFileUpload visibleColumns={["fileName", "status", "progress", "action"]} />

// 下载：只显示 文件名 / 大小 / 状态 / 操作
<ZustandFileDownload visibleColumns={["fileName", "fileSize", "status", "action"]} />
```

列 key（区分大小写）：

- 上传 `UploadColumnKey`：`index` | `fileName` | `fileSize` | `chunkCount` | `status` | `progress` | `action`
- 下载 `DownloadColumnKey`：`fileName` | `fileSize` | `chunks` | `status` | `progress` | `action`

> `SimpleUploadList` / `SimpleDownloadList` 走各自独立的列集，当前未暴露 `visibleColumns`。

完整 Props 说明与回调（`onUploadStart/Progress/Complete/Error`、`onBatchComplete`、`onStorageChange` 等）见
[docs/components.md](https://github.com/frankvane/react-upload-indexeddb/blob/main/docs/components.md)。

## 鉴权

组件不持有凭证，鉴权全部通过 props 注入：

| 场景 | 做法 |
| --- | --- |
| 跨域 Bearer（推荐） | `getAuthToken` / `authToken` / `getAuthHeaders`；`withCredentials` 保持默认 `false` |
| 同域 Cookie | 无需任何配置（默认 `same-origin` 自动携带） |
| 跨域 Cookie | `withCredentials: true`（服务端需返回 `Access-Control-Allow-Credentials: true` 且 Origin 不能为 `*`） |

```tsx
// 每次上传前从登录态取最新 token（推荐，支持刷新）
<ZustandFileUpload
  baseURL="https://upload.example.com"
  getAuthToken={async () => {
    return await readPortalToken();
  }}
/>

// 完全自定义头（可同时塞多个业务头）
<ZustandFileUpload
  baseURL="https://upload.example.com"
  getAuthHeaders={async () => ({
    Authorization: `Bearer ${await readPortalToken()}`,
    "X-Tenant-Id": currentTenantId,
  })}
/>
```

下载侧 props 语义相同；列表请求（axios）也可用 `setDownloadAuth(headers)` 注入。
服务端参考实现见 [docs/server-api-contract.md](https://github.com/frankvane/react-upload-indexeddb/blob/main/docs/server-api-contract.md)（`server/src/middleware/auth.js` 可插拔 Bearer/Cookie 中间件）。

### ⚠️ 安全部署提示

> 配套的 demo / 参考服务端（`server/`）**鉴权中间件默认关闭**，仅用于本地联调与演示。**生产部署必须自行启用鉴权**：
>
> - 启用 `server/src/middleware/auth.js` 的 Bearer / Cookie 校验（通过环境变量打开）；
> - 任何对外暴露的上传/下载接口都应在网关或服务端强制校验身份，否则攻击者可任意上传/下载/读取他人文件；
> - 切勿将未鉴权的文件接口直接暴露在公网。
>
> 组件层已做到「不持有凭证、纯 props 注入」，但服务端是否鉴权由部署方负责——库本身**不承诺服务端安全**。

## 调试日志

库默认**静默**：仅真实失败以 `console.error` 透出，调试/重试提示默认不打印，避免生产环境控制台噪声。

排查问题时打开全部日志：

```ts
import { configureDebug } from "react-upload-indexeddb";

configureDebug({ silent: false }); // 打开 warn/debug 级日志
```

> 上传 Worker 另有**按任务**的调试开关：传 `uploadConfig.debug === true` 时，分片级日志会按 200ms 节流并经 `postMessage` 上报主线程（被 demo 的 DebugPanel 消费），不受 `configureDebug` 影响；`configureDebug` 仅控制是否同步打印到浏览器控制台。

## 界面示意

### 下载模式

![下载模式](https://raw.githubusercontent.com/frankvane/react-upload-indexeddb/main/docs/assets/readme/mode-download.png)

### 简化模式

![简化模式](https://raw.githubusercontent.com/frankvane/react-upload-indexeddb/main/docs/assets/readme/mode-simple.png)

> 截图可通过 `npm run docs:screenshot` 重新生成（默认访问 `http://127.0.0.1:5173`）。

## 架构

![架构总览](https://raw.githubusercontent.com/frankvane/react-upload-indexeddb/main/docs/assets/readme/architecture.png)

前端在"网络检测 + 自动策略 + IndexedDB 持久化"协同下执行上传/下载；后端负责分片状态、文件合并和文件列表聚合。

![上传时序](https://raw.githubusercontent.com/frankvane/react-upload-indexeddb/main/docs/assets/readme/upload-sequence.png)

![下载时序](https://raw.githubusercontent.com/frankvane/react-upload-indexeddb/main/docs/assets/readme/download-sequence.png)

> 图源（Mermaid）维护在 [docs/architecture.md](https://github.com/frankvane/react-upload-indexeddb/blob/main/docs/architecture.md)，
> 由 `npm run docs:mermaid` 渲染为 PNG（npmjs.com 不渲染 Mermaid，故 README 引用 PNG）。

## 服务端 API 概览

统一前缀 `/api/file/*`：

- 上传链路：`POST /instant`（秒传/分片检查）、`POST /upload`、`POST /merge`、`GET /status`
- 下载链路：`GET /list`、`GET /download/:file_id`（支持 Range）

本仓库 `server/` 自带一个 Express + SQLite 参考后端（`npm run server:dev`），完整契约见
[docs/server-api-contract.md](https://github.com/frankvane/react-upload-indexeddb/blob/main/docs/server-api-contract.md)。

## 本地开发（demo 站点）

```bash
npm install
npm --prefix server install

# 终端 1：后端（http://127.0.0.1:3000）
npm run server:dev

# 终端 2：前端 demo（http://127.0.0.1:5173）
npm run dev
```

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 前端 demo 开发服务 |
| `npm run server:dev` | 参考后端服务 |
| `npm run build` | 组件库构建（ESM + CJS + d.ts + style.css） |
| `npm run build:demo` | demo 站点构建 |
| `npm run test:unit` | 前端单元测试 |
| `npm run verify` | 前后端联合验证 |
| `npm run docs:screenshot` | 重新生成 README 界面截图 |
| `npm run docs:mermaid` | 重新渲染 README 架构图 PNG |

## 重要版本说明（v2.0.0 起）

- **`UploadFile.buffer` 移除（Breaking）**：IndexedDB 不再持久化整文件字节；文件字节按分片惰性读取，内存峰值与文件大小解耦
- **刷新续传语义变更（Breaking）**：页面刷新后需**重新选择同一文件**续传——运行时文件引用不落盘，已完成分片由服务端分片检查自动跳过，不会重复上传
- **`hashMode` prop（可选）**：默认 `"full"` 全量流式哈希；大文件可切 `"sample"` 采样哈希跳过绝大部分读取（分片级 md5 校验仍全覆盖）

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [组件使用文档](https://github.com/frankvane/react-upload-indexeddb/blob/main/docs/components.md) | Props / 回调 / 集成示例 |
| [架构详图](https://github.com/frankvane/react-upload-indexeddb/blob/main/docs/architecture.md) | 流程图 / 时序图 / 自动策略（Mermaid 源） |
| [API 契约](https://github.com/frankvane/react-upload-indexeddb/blob/main/docs/server-api-contract.md) | 请求响应结构与错误语义 |
| [依赖瘦身分析](https://github.com/frankvane/react-upload-indexeddb/blob/main/docs/dependency-slimming-analysis.md) | 去 antd / ahooks 的动机与方案 |
| [变更日志](https://github.com/frankvane/react-upload-indexeddb/blob/main/CHANGELOG.md) | 每个版本的变更明细 |

## License

MIT
