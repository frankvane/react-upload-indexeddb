# Change Log

本项目的所有显著变更都会记录在本文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **T4.3 去除 antd 依赖（Breaking Change 预备项，建议 v1.3.0 独立发版）**：
  - 新增内置 UI 套件 `src/ui/`（19 个组件 + 19 个内联 SVG 图标 + 15 kB CSS，视觉贴近 antd v5，全部 `rui-` 前缀）：
    - `primitives.tsx`：Button / Tag / Badge / Spin / Empty / Divider / Card / Space / Alert / Statistic / Progress / Switch / InputNumber / Slider
    - `typography.tsx`：Typography（Text/Paragraph/Title）+ Row/Col 24 栅格
    - `feedback.tsx`：Tooltip / Popconfirm / Modal（含 `Modal.confirm`）/ Drawer（portal + ESC + 焦点管理）
    - `collapse.tsx` / `table.tsx` / `message.tsx` / `icons.tsx`（path 数据提取自 @ant-design/icons，视觉一致）
    - `ui.css`：静态样式表，`vite.config.ts` lib 模式 `cssFileName: "style"` 产出 `dist/style.css`（15.25 kB / gzip 3.41 kB）
  - 19 个业务文件全部替换 antd 导入为 `rui-ui`，`src` 中 antd 引用清零；`package.json` peerDependencies 删除 antd（仅剩 react / react-dom / zustand）；卸载 antd 与 @ant-design/icons
  - demo 构建删除 antd manualChunks 分组：产物体积从 ~1297 kB 降至 ~368 kB（**-71%**），vite 7 循环 chunk 警告清零
  - 上传侧 store 的 `MessageInstance` 类型改为引用自研 message（`src/index.ts` 导出该类型供消费方注入）
  - 兼容性说明：已在用 antd 的消费方不受影响（`rui-` 前缀样式隔离），但组件默认观感由 antd 设计语言变为库自带样式；**建议独立分支 + v1.3.0 发布**，并同步 README 的样式引入指引（`import "react-upload-indexeddb/dist/style.css"`）
- **T4.2 去除 ahooks 依赖**：自研 `src/shared/useNetwork.ts`（对齐 ahooks `useNetwork` 实际使用的 `online`/`rtt`/`type`/`effectiveType` 四字段，事件源一致，SSR 安全），替换上传/下载两侧 `useNetworkDetection`；`dependencies` 仅剩 `axios`/`localforage`/`spark-md5`，消费方不再传递安装 ahooks；新增 `useNetwork.test.ts` 5 用例（初值/online/offline/connection change/卸载清理）
- **T2.8 测试体系与 CI**：新增 `.github/workflows/ci.yml`（lint → 客户端 test+coverage → 契约校验 → server test → 构建 → pack dry-run）；客户端测试 **21 文件 / 108 用例**，服务端 5 文件 / 29 用例；`vite.config.ts` 启用覆盖率门槛（ratchet 策略：全库 lines 35 / funcs 30 / branch 25，`src/shared` 80（当前 96.4/94.9/100/96.7 已大幅达标）、`services` 65/70/65/60；长期目标 60% / 80% 记录在案逐步提高）
- **T2.7 下载列表性能与安全**：`collectAllFiles` 加 5s TTL + 源目录 mtime 签名缓存（增删立即可见、内容不变零扫描）；`file_id` 格式校验（sha256 hex）后非法 id 直接 404 不扫描；`fileIdCache` 改 LRU（上限 5000）；`findFileById` 未命中不再循环全量扫描；`/list` 支持 `page`/`pageSize` 分页（默认全量兼容）
- **T2.6 服务端健壮性**：
  - 合并流程重 IO（readFile/appendFile/md5File/缩略图）移出长事务，改为事务外合并 + 短事务写库，根治大文件合并期间 SQLITE_BUSY
  - 新增 `server/src/janitor.js`：启动时 + 每 6h 扫描 `tmp/upload`，删除超过 `TMP_TTL_HOURS`（默认 24h）的孤儿分片（`.gitkeep` 受保护），`index.js` 启动时接入
  - multer 分片上限 env 化（`CHUNK_MAX_SIZE_MB`，默认 20）
  - CORS 白名单（`CORS_ORIGIN`，默认 `*` 兼容；具体 origin 时自动开 credentials）+ `express-rate-limit` 限流（`RATE_LIMIT_MAX` 默认 300/min/IP，测试环境默认关闭）
  - 下载流（Range 与全量两处）监听 `req.on("close")` 销毁，避免客户端中断后 fd 泄漏
  - `.env.example` 补充全部新增环境变量说明
- **T2.5 下载侧存储性能**：`ChunkPersistenceService` 五个查询方法改为 `chunkStore.iterate()` 单游标扫描（500 分片从 500 次事务降为 1 次）；合并完成（`handleMergeComplete` / `mergeInMainThread`）后异步 `removeAllChunks`，消除 chunks + completeFiles 双份占用；`calculateStorageSize`/`calculateFileSize` 删除 `JSON.stringify(file).length` 估算，改为只统计 Blob 实际字节
- 新增 devDependency `fake-indexeddb`，`chunkPersistenceService.test.ts` 覆盖 500 分片单游标、合并后清理、多文件前缀隔离
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
- **T4.1 测试工具链升级**：vitest 2.1.8 → 5.0.5 + vite 5.4 → 7.3.7 + `@vitejs/plugin-react-swc` 3.10 → 4.3.3（vitest 5 硬性要求 Node ≥ 22.12 且 vite ≥ 6.4 为 peer）；coverage provider 由 v8 切 **istanbul**——v8 与 SWC 的 AST 重映射存在已知兼容问题（vitest-dev/vitest#9293，内联组件 0%/大幅低报，ast-v8-to-istanbul 修复后于本仓库实测仍复现），istanbul 源码级插桩数字准确（networkStrategy 补测后 `src/shared` 达 96.4%）；覆盖率门槛按 istanbul 实测值重校；CI Node 20 → 22
- demo 构建 `manualChunks` 简化：antd 8 个细分 chunk 合并为单一 `vendor-antd`（vite 7 新 Rollup 对原分组报循环 chunk 警告），`@rc-component/*`/`react-is`/`zustand` 归入正确分组，循环警告清零（T4.3 去 antd 后该分组将删除）
- `networkStrategy.test.ts` 4 → 17 用例：补 rtt 梯度（50/100/200/500/1000/1001ms）、ethernet、effectiveType 单因素、全缺省回退、`navigator.onLine` 回退、离线忽略 rtt 等分支
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
