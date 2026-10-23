# Change Log

本项目的所有显著变更都会记录在本文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **T2.3 Worker CANCEL 协议**：上传 Worker 新增 `cancel` 消息与 `cancelled` 响应；每个任务维护 AbortController，取消时中断全部在途 fetch 与重试；bridge 新增 `cancelUploadTask(fileId)`（800ms 无响应则 terminate 兜底）；取消后文件状态回 `QUEUED` 并释放 buffer
- **T2.1 `mergeApi` prop**：合并接口路径可配（默认 `API_PATHS.file.merge`）；新增 `src/shared/url.ts` 的 `joinUrl`，`baseURL` 带尾斜杠不再产生 `//api/`
- **T2.2 分片存储键解耦**：服务端 `file_id` 改为客户端生成的 `${md5}_${size}_${chunkSize}` 复合键（`src/shared/chunkKey.ts`），网络自适应调整 `chunkSize` 后新旧分片互不污染；上传队列 id 增加随机后缀（`src/shared/fileId.ts`），同内容文件不再互相覆盖
- 服务端 `instantCheck` 增加 `chunk_size` 一致性校验：复合键与请求 `size`/`chunk_size` 不符时清空旧分片结果并返回 `reset:true`；旧版纯 md5 键请求保持兼容
- server 依赖安装并就绪（`npm --prefix server install`），`server/tests/chunk-key.test.js` 新增 4 个分片键集成测试；`server` test script 改为串行执行，避免并行测试共享 tmp/uploads 目录互相清理

### Fixed
- **P1-8 取消残留**：修复 `runUploadTask` 中 abort 竞态下 `finish` 提前返回导致 signal 监听与 Worker 不清理的泄漏；Worker 内 fetch 现按任务级 AbortController 中断
- **P0-1 下载分片鉴权**：`FileDownload` 新增 `authToken` / `getAuthToken` / `getAuthHeaders` / `authScheme` / `withCredentials` props；鉴权头随 `START_DOWNLOAD` 下发到 Worker，分片 Range 请求合并注入（默认 `same-origin`，仅 `withCredentials:true` 时 `include`）
- **P0-2 上传 `withCredentials` 打通**：`UploadProvider` 此前漏解构/漏传 `withCredentials`，导致 Cookie 鉴权模式恒不生效；现已贯通 props → Context → effective config → Worker
- **P2-29 `configureDownloadApi` 缺省重置**：`withCredentials` 缺省改为保留现值；`baseURL` 仅在非空字符串时覆盖，组件重复 mount 不再清空既有配置
- **P2-28 简化模式清理**：`SimpleUploadList` 批次结束仅移除上传成功的文件，失败文件保留并提示重试
- **P1-9 定时器/资源清理**：上传 Worker `fetchWithRetry` 超时定时器收敛到 `finally`（覆盖 5xx 重试与网络异常分支）；`useFileProcessor` 自动上传定时器 ref 化并在卸载时清理；清理策略删除 `setTimeout` 兜底，仅保留 `setInterval` 单触发源

### Changed
- 新增 `prepack` / `prepublishOnly` 脚本：发布前强制构建，避免空包发布
- `server/package.json` 删除未使用的自引用依赖 `react-upload-indexeddb: file:..`
- `.lh/` 编辑器缓存目录出库（`.gitignore` 已包含）
- 鉴权头解析抽至 `src/shared/authHeaders.ts`，上传/下载两侧共用（`resolveAuthHeaders` 公共导出不变）

## [1.0.5] - 2026-10-22

### Fixed
- 上传 CORS：Worker 内 fetch credentials 由硬编码 `include` 改为默认 `same-origin`，仅 `withCredentials:true` 时才 `include`，根治跨域 Bearer 头鉴权被 CORS preflight 拦截

## [1.0.4] - 2026-10-22

### Fixed
- 四个 Worker 统一改为 `?worker&inline` 内联为 Blob，修复消费方 dev 环境下 worker 资产 404 导致的"文件预处理失败"

## [1.0.3] - 2026-10-22

### Fixed
- Worker 路径解析由 `base:'./'` 改为相对路径

## [1.0.2] - 2026-10-22

### Added
- 补充 `export default`，成为 vane-upload 的纯 drop-in 替换

## [1.0.1] - 2026-10-22

### Changed
- 放宽 antd peerDependencies 至 `^5 || ^6`

## [1.0.0] - 2026-10-22

### Added
- 首个发布就绪版本：公共入口 `src/index.ts`、lib 模式构建（ESM + CJS 双产物）、`emitDeclarationOnly` 类型产物
- props 注入式鉴权（`authToken` / `getAuthToken` / `getAuthHeaders` / `authScheme` / `withCredentials`）
- 服务端可插拔鉴权中间件 `server/src/middleware/auth.js`（默认关闭，env 开启）
