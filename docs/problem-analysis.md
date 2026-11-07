# 项目问题分析报告

> 审计对象：`react-upload-indexeddb`（React 大文件分片上传/下载组件库 + Node 后端）
> 审计基线：2026-11-06 磁盘当前代码（未修改任何源码）
> 审计方式：逐文件静态阅读 + 关键路径交叉验证（`tsc -b`、`eslint`、`vitest --coverage`、`npm ls`、`npm audit`、`npm pack --dry-run`），未启动服务做端到端验证
> 覆盖范围：功能与逻辑缺陷、上传/IndexedDB 链路（并发、事务、配额、版本升级、错误处理）、性能、代码结构与可维护性、依赖与构建、类型与测试缺口

## 一、结论摘要

共确认 **29 个可复现/可确证的问题**：P0 3 个、P1 8 个、P2 15 个、P3 3 个。

| 严重程度 | 数量 | 核心含义 |
| --- | --- | --- |
| P0 阻断 | 3 | 核心功能不可用，或可被直接利用的安全问题 |
| P1 严重 | 8 | 常见路径下出现数据错误/损坏、安全风险或门禁失效 |
| P2 中等 | 15 | 特定条件下出错，或性能、可维护性、发布产物问题 |
| P3 轻微 | 3 | 工程化改进与体验优化 |

**最需要优先处理的三件事**：

1. **下载链路目前是断的**：正常下载完成后不合并、且立即删除分片，导致随后「导出」必然报「分片不完整」。
2. **服务端存在可被利用的写入与鉴权缺陷**：`md5` 未净化即参与落盘路径，且完整性校验强度由客户端参数决定；Cookie 鉴权在配置后形同虚设。
3. **上传侧的性能与状态一致性**：所有分片 MD5 串行预计算后才开始上传，大文件首字节延迟线性增长；worker 任务无超时，异常时文件会永久卡在「上传中」。

## 二、严重程度定义

| 等级 | 判定标准 |
| --- | --- |
| P0 | 主流程不可用，或安全问题可被直接利用且无需特殊前提 |
| P1 | 常规使用即可能触发；造成数据错误/损坏、安全边界失守、CI 门禁必然失败 |
| P2 | 需要特定时序/配置才触发；或性能、资源、发布产物缺陷 |
| P3 | 不影响功能，属工程化与体验改进 |

---

## 三、P0 问题

### P0-1 下载完成后从不合并，却立即删除全部分片，导致导出必然失败

- **涉及文件与位置**
  - `src/components/ZustandFileDownload/services/downloadEventHandlers.ts:65-71`
  - `src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts:230-233`
  - `src/components/ZustandFileDownload/utils/downloader.ts:55-72`
  - `src/components/ZustandFileDownload/hooks/useDownloaderLifecycle.ts:67-68`
- **问题描述**：下载 worker 的 `COMPLETE` 事件只经过 `handleDownloadComplete`：健康检查通过后执行 `mergeService.markCompleted(file)`（仅更新状态，**不写 `completeFileStore`**），随后 `void chunkService.removeAllChunks(...)` 删除全部分片。真正执行合并的 `mergeFile` 只在 `startDownload` 发现 `pendingChunks.length === 0` 时才会被调用；正常「从网络下载」的路径永远走不到这里。用户点「导出」时 `exportFileToLocal` 先读 `completeFileStore`（为空），再逐个检查分片（已被删除），最终抛出 `文件分片不完整，无法导出文件`。
- **影响**：下载 → 导出这条主链路在正常使用下 100% 失败；只有当用户在异步删除完成前的毫秒级窗口内点导出才可能成功。这是本库下载能力的核心功能缺陷。
- **建议修复方向**：`COMPLETE` 流程改为「先合并（写入 `completeFileStore`，可做 md5 终检）→ 成功后再删分片」；或保留分片、仅在导出时合并。两条策略只能选一条并统一，不能一半删一半不合并。

### P0-2 `md5` 未做格式校验即参与落盘路径拼接，配合客户端可控的 `hash_mode` 可路径穿越写文件

- **涉及文件与位置**
  - `server/src/controllers/uploadController.js:74-80`（`buildStoredFileName` 直接插值 `md5`）
  - `server/src/controllers/uploadController.js:339-344`（`md5` 仅判空）
  - `server/src/controllers/uploadController.js:406-408`（拼接 `UPLOADS_DIR` 并先写入空文件）
  - `server/src/controllers/uploadController.js:448`（`hash_mode !== "sample"` 才做全量 md5 比对）
  - `server/src/utils/fileSecurity.js:74-80`
- **问题描述**：`buildStoredFileName(safeFileId, md5, safeName)` 把请求体里的原始 `md5` 直接拼进文件名。`sanitizeFileId` / `sanitizeFilename` 只净化了 `file_id` 与 `name`，`md5` 与 `size`、`total` 都没有格式约束。正常路径下，合并末尾的全量 md5 比对可以挡住非法 md5；但该比对是否执行由客户端传入的 `hash_mode` 决定——传 `hash_mode: "sample"` 即可跳过。此时 `md5 = "../../../evil"` 会让 `path.join(UPLOADS_DIR, ...)` 归一到 `UPLOADS_DIR` 之外，`writeFile(targetPath, Buffer.alloc(0))` 后继续 append 分片内容，形成任意路径写入/覆盖。
- **影响**：在对外可访问的后端上，这是可被直接利用的任意文件写入（内容与大小均由攻击者控制）；即便不用于攻击，异常 md5 也会污染存储目录结构。
- **建议修复方向**：对 `md5` 强制 `^[a-f0-9]{32}$` 校验（非法直接 400）；落盘前断言 `path.resolve(targetPath).startsWith(path.resolve(UPLOADS_DIR) + path.sep)`；完整性校验强度不得由客户端参数降级（服务端自行决定，或对 `sample` 模式保留独立的全量校验）。

### P0-3 配置 `FILE_AUTH_COOKIE` 后，任意非空 Cookie 值即可通过鉴权

- **涉及文件与位置**
  - `server/src/middleware/auth.js:69-76`
  - `server/src/app.js:79-96`
- **问题描述**：`app.js` 在 `AUTH_MODE !== "demo"` 时读取 `FILE_AUTH_COOKIE` 作为 cookie 名并传入中间件，但**从未传入 `verify`**。中间件 Cookie 分支只判断「能否取到非空值」：有 `verify` 才校验，没有就直接 `next()`。因此配置 Cookie 鉴权（README 推荐的非 Bearer 场景）后，攻击者发送 `Cookie: <name>=x` 即可访问 `/api/file/*` 全部接口。
- **影响**：鉴权完全失效，上传、下载、列表、删除全部裸奔；Bearer 白名单在此模式下不生效。
- **建议修复方向**：Cookie 分支必须与白名单/签名/会话做实际比对；未提供 `verify` 时应 fail-closed（启动即报错或拒绝请求），不能「存在即通过」。同时补一条针对该分支的集成测试。

---

## 四、P1 问题

### P1-1 下载 `COMPLETE` 与分片落盘并发处理，导致「分片缺失」误判并反复暂停

- **涉及文件与位置**
  - `src/components/ZustandFileDownload/hooks/useDownloaderLifecycle.ts:60-74`
  - `src/components/ZustandFileDownload/services/downloadEventHandlers.ts:50-63`
  - `src/components/ZustandFileDownload/services/chunkPersistenceService.ts:23-50`
- **问题描述**：worker 逐条 `postMessage(CHUNK_DOWNLOADED)`，主线程的 `onmessage` 虽是 `async`，但浏览器不会等待上一个 handler 的 Promise 结束。而 `onChunkDownloaded` 要写 IndexedDB（失败还会 sleep 500ms 重试 3 次），`COMPLETE` 往往在落盘未完成时就被派发；`handleDownloadComplete` 立刻扫描 IndexedDB 做健康检查，把「尚在写入」的分片判为缺失，文件被置为 `PAUSED` 并提示「下载不完整」。
- **影响**：分片越多、设备越慢越容易必现；用户看到进度回退、反复暂停，重试也无法稳定完成。
- **建议修复方向**：主线程按 `fileId` 维护落盘 Promise 队列，处理 `COMPLETE` 前先 `await` 该文件全部落盘任务；或由 worker 在所有分片收到 ACK 后再发 `COMPLETE`。

### P1-2 合并直接写入对外服务目录，且先清零目标文件，列表/下载可读到 0 字节或半成品

- **涉及文件与位置**
  - `server/src/controllers/uploadController.js:406-408`
  - `server/src/controllers/downloadController.js:188-199`
- **问题描述**：合并目标直接落在 `UPLOADS_DIR`（同时也是被 `/api/file/list` 列举、被下载的目录）。合并一开始就 `writeFile(targetPath, Buffer.alloc(0))` 再逐块 append；而列表是读目录而非读 DB，`fileId = sha256(path)` 稳定不变。
- **影响**：合并期间列表中出现该物理文件且长度为当前进度，客户端可立即按 Range 下载到截断内容；若目标路径已存在旧完整文件（同名 md5 重传），会被先清零，存在丢失既有文件的风险。
- **建议修复方向**：先写 `TMP_DIR` 下的 `*.part` 临时文件，校验通过后 `rename` 原子替换；列表只展示最终文件。

### P1-3 网络自适应改变 `chunkSize` 会覆盖已固化的分片方案，导致旧分片索引错位

- **涉及文件与位置**
  - `src/components/ZustandFileDownload/store/index.ts:136-149`
  - `src/components/ZustandFileDownload/hooks/useDownloadFiles.ts:265-273`
  - `src/components/ZustandFileDownload/hooks/downloadPolicy.ts:28-37`
- **问题描述**：`fetchDownloadFiles` 用**当前 store 的 `chunkSize`** 对所有文件重算 `totalChunks` 并写回 `chunkSize`，覆盖 IndexedDB 中该文件已持久化的分片大小。网络检测改变 `chunkSize` 会触发 `fetchFileList(true)`，此后 `normalizeDownloadFile` 采用新值，而 `getPendingChunks` 只判断 `0..totalChunks-1` 是否存在。
- **影响**：例如 10MB 文件原 10×1MB，切到 5MB 后 `totalChunks=2`，索引 0/1 已存在 → 判定「无需下载」→ 合并出 2MB 的「完成」文件。服务端返回 md5 时会报校验失败；md5 缺失时直接产出损坏文件并写入 `completeFileStore`。
- **建议修复方向**：分片方案一经确定即固化到 `fileStore`，列表刷新不得覆盖；`chunkSize` 变化时清理未完成文件的旧分片并重置进度，再重新下载。

### P1-4 分片上传阶段没有累计容量与文件数上限，配额检查只在 merge 时执行

- **涉及文件与位置**
  - `server/src/controllers/uploadController.js:295-319`（分片写入）
  - `server/src/controllers/uploadController.js:357-367`（`MAX_UPLOAD_SIZE_MB` / `MAX_CHUNKS` 仅 merge 校验）
  - `server/src/middleware/uploadChunk.js`（仅限制单请求体积）
- **问题描述**：`/upload` 只校验 `index` 范围和单请求 20MB，`MAX_UPLOAD_SIZE_MB`、`MAX_CHUNKS` 只在合并时检查。攻击者或异常客户端可对任意 `file_id` 写入最多 10 万个分片且从不调用 merge；janitor 只按 mtime 清理（默认 24h），持续写入即可让磁盘被占满。`user_id` 也不参与任何配额。
- **影响**：单机磁盘可被打满，进而影响同机其他服务；属于低成本 DoS。
- **建议修复方向**：按 `file_id` / `user_id` 维护已写入字节数与分片数，在 `/upload` 入口校验并返回 413；结合首次分片登记的 `size` / `total` 做前置配额。

### P1-5 样式子路径与 README 不一致，按文档接入会解析失败且组件无样式

- **涉及文件与位置**
  - `package.json:39`（`exports["./style.css"]`）
  - `README.md:33`
  - `src/index.ts:3`
- **问题描述**：`exports` 只暴露 `./style.css`，但 README 与源码注释要求消费方 `import "react-upload-indexeddb/dist/style.css"`。一旦声明 `exports`，未列出的子路径即不可解析（Node 报 `ERR_PACKAGE_PATH_NOT_EXPORTED`，Vite/webpack 报 `Missing './dist/style.css' specifier`）。
- **影响**：按官方文档接入的消费方直接构建失败；绕过报错则会得到无样式的组件。
- **建议修复方向**：文档统一改为 `react-upload-indexeddb/style.css`，或在 `exports` 补 `"./dist/style.css": "./dist/style.css"`；CI 增加对 README 中 specifier 的真实 resolve 校验。

### P1-6 生产依赖含 high 漏洞，CI 的审计步骤必然失败

- **涉及文件与位置**
  - `package.json:70`（`axios: ^1.20.0`）
  - `.github/workflows/ci.yml`（「生产依赖安全审计」步骤）
- **问题描述**：axios 的传递依赖 `follow-redirects@1.16.1` 命中 high 漏洞（GHSA-mrwp-f3q8-3g9p，跨域重定向可能泄漏凭据）。`npm audit --omit=dev` 在存在 high 时非零退出，而 CI 直接调用该命令，注释与 CHANGELOG 却写「当前 0 漏洞」。
- **影响**：CI 红；若绕过审计则把已知漏洞发布给消费方。
- **建议修复方向**：升级 axios，或在 `overrides` 中把 `follow-redirects` 抬到 `^1.16.2`；重跑审计后同步更新 CI 注释与 CHANGELOG 结论。

### P1-7 覆盖率阈值不在本地门禁中生效，下载链路核心代码覆盖率为 0%

- **涉及文件与位置**
  - `package.json:55-59`（`test` / `test:unit` / `verify:client` 均无 `--coverage`）
  - `vite.config.ts:41-63`（`thresholds` 仅在 `--coverage` 下生效）
  - `src/components/ZustandFileDownload/`（`index.tsx`、`FileList.tsx`、`useFileDownloaderController.ts`、`useDownloadFiles.ts`、`useStorageManager.ts` 实测 0%）
- **问题描述**：阈值只写在配置里，本地 `npm test` / `npm run verify` 都不带覆盖率，任意回退不会被发现；只有 CI 单独跑 `vitest run --coverage`。同时下载侧 UI 与编排层整块空白，全局 35% 线被类型文件与 services 拉高后仍能通过。
- **影响**：门禁形同虚设；P0-1、P1-1、P1-3 这类主流程缺陷在自动化中完全没有回归保护。
- **建议修复方向**：新增 `test:coverage` 并接入 `test` / `verify`；对 `src/components/ZustandFileDownload/{hooks,components}/**` 单独设阈值；按实测值 ratchet（先抬到 40/40/32/30）。

### P1-8 上传 worker 任务没有超时保护，worker 无响应时文件永久停留在「上传中」

- **涉及文件与位置**
  - `src/components/ZustandFileUpload/services/uploadWorkerBridge.ts:159-220`
  - `src/components/ZustandFileUpload/services/uploadWorkerBridge.ts:131-140`（仅 cancel 有 800ms 兜底）
- **问题描述**：`runUploadTask` 返回的 Promise 只在收到 worker 的 `done` / `error` / `cancelled` 时 settle，没有任务级超时；只有取消路径有 `CANCEL_FALLBACK_MS` 强制 terminate。若 worker 内部卡死（例如读取本地文件抛错未捕获、内存压力导致线程挂起），Promise 永不结束。
- **影响**：文件状态停在 `UPLOADING`，进度不再变化，用户点取消也要等兜底；批量队列被这个槽位长期占用，后续文件排队不前进。
- **建议修复方向**：为每个任务设置可配置的空闲超时（例如 N 秒无进度消息即判失败），超时后 terminate 该 worker 并把任务标记为可重试。

---

## 五、P2 问题

### P2-1 上传前串行预计算全部分片 MD5，大文件首字节延迟线性增长

- **位置**：`src/components/ZustandFileUpload/worker/uploadWorker.ts:486-514`、`:516-531`
- **问题描述**：进入上传前先 `for (let i = 0; i < chunkCount; i++)` 依次 `fileRef.slice(...).arrayBuffer()` 计算每个分片的 md5，全部算完才发起秒传确认与首个分片上传；随后 `chunk_md5s` 会整体放进 `instantCheck` 的 JSON 请求体。
- **影响**：10GB 文件按 1MB 分片需要 1 万次串行读取与哈希，用户长时间看不到「开始上传」；`chunk_md5s` JSON 可达数百 KB，且无分页/流式处理。
- **建议修复方向**：改为「按需计算」——上传到第 N 片时才算第 N 片 md5；秒传检查改为分批或仅用文件级 hash + 抽样；`chunk_md5s` 不在首包一次性提交。

### P2-2 清理倒计时期间被重新上传的文件会被从 UI 列表移除

- **位置**：`src/components/ZustandFileUpload/services/cleanupPolicy.ts:139-161`
- **问题描述**：`cleanupCompletedFilesFromUI` 对 `completedFileIds` 中的文件只做三种处理：状态为 `ERROR` 则保留并移出集合，其余一律 `return false`（从列表移除）。若文件在倒计时期间被重新上传，状态变为 `UPLOADING`，既不会被删除也不会被保留，直接被过滤掉。
- **影响**：用户看到正在上传的文件从列表消失，但后台仍在传；刷新后可能重新出现，状态自相矛盾。
- **建议修复方向**：显式判断「仅 `DONE` / `INSTANT` 才移除」，其余状态保留并从 `completedFileIds` 中剔除。

### P2-3 `maxFiles` 只校验本次选择，多次选择可绕过限制

- **位置**：`src/components/ZustandFileUpload/hooks/useFileProcessor.ts:104-107`
- **问题描述**：`validateFiles` 只比较本次 `files.length` 与 `uploadConfig.maxFiles`，不看已存在于 store / IndexedDB 中的文件数量。
- **影响**：分批选择可无限堆积文件，与配置语义不符；配合无上限的并发会放大内存与存储压力。
- **建议修复方向**：校验时把当前已存在的文件数计入（`existing + incoming <= maxFiles`）。

### P2-4 上传元数据持久化没有 schema 版本与迁移策略

- **位置**：`src/components/ZustandFileUpload/services/uploadStorageInstance.ts:18-23`、`uploadStorage.ts:72-108`
- **问题描述**：`localforage.createInstance` 只指定 `name` / `storeName`，没有 `version`、`upgrade` 或字段兼容层；`UploadFile` 结构变化后，旧记录会被原样读回并直接参与状态恢复。
- **影响**：升级组件版本后，旧持久化数据可能缺字段或语义变化，表现为恢复出的任务状态错误、无法继续上传；没有显式的破坏性升级路径。
- **建议修复方向**：为存储记录加 `schemaVersion`，读取时做迁移或丢弃不兼容记录；重要结构变更时升级 `localforage` 版本并处理 `upgrade` 回调。

### P2-5 下载分片落盘失败被静默吞掉，配额错误也只是无差别重试

- **位置**：`src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts:95-104`、`src/components/ZustandFileDownload/services/chunkPersistenceService.ts:23-50`
- **问题描述**：`saveChunkWithRetry` 返回 `false` 时调用方忽略返回值，worker 侧已按成功计入进度；`QuotaExceededError`（或隐私模式禁用存储）被 `catch` 后固定 sleep 500ms 重试 3 次再放弃，全仓没有落盘前的 `navigator.storage.estimate()` 预检（`useStorageManager` 仅用于展示）。
- **影响**：进度条冲到 100% 后被打回「分片缺失」，用户拿不到「空间不足」的真实原因；排查成本高。
- **建议修复方向**：区分可重试与不可重试错误（配额、权限立即上报）；落盘失败向 worker 反压或终止该文件；下载前做配额预检并给出明确提示。

### P2-6 下载重试耗尽的分片被静默丢弃，worker 仍发送 `COMPLETE` 与 100% 进度

- **位置**：`src/components/ZustandFileDownload/worker/downloader.worker.ts:241-262`
- **问题描述**：`retriableChunks` 过滤掉已达重试上限的分片后，若 `remainingChunks` 变空即进入「完成」分支，强制 `sendProgressUpdate(..., totalChunks, totalChunks, true)` 并 `post COMPLETE`，即使 `downloadedChunks < totalChunks`。
- **影响**：前端先显示「已完成/100%」，再被健康检查打回暂停；这批分片本轮不再重试，用户观感是「说好了又变卦」。
- **建议修复方向**：仅当所有索引都成功时才发 `COMPLETE`；否则携带缺失索引按失败上报，让上层进入可重试的暂停态。

### P2-7 `startDownload` 没有重入保护，重复触发会并发跑两条下载循环

- **位置**：`src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts:193-236`
- **问题描述**：`mergeFile` 有 `processingFiles.has(file.id)` 前置守卫，`startDownload` 没有任何守卫，也不检查 store 中该文件状态；按钮 disabled 只依赖渲染状态。双击或批量与单文件同时触发时，会向同一 worker 发两条 `START_DOWNLOAD`。
- **影响**：同一 `fileId` 并发两个循环写同一批 chunk key、各自 `post COMPLETE`，可能重复合并、重复写 `completeFileStore`，并与 `removeAllChunks` 交错产生孤儿分片。
- **建议修复方向**：入口做 `processingFiles` 幂等判断；worker 收到同 `fileId` 的 `START` 时忽略或先取消旧循环。

### P2-8 无 DB 记录的文件下发「部分 md5」，>10MB 时合并终检必然失败

- **位置**：`server/src/controllers/downloadController.js:109-113`、`server/src/utils/hash.js:52-81`、`src/components/ZustandFileDownload/worker/merger.worker.ts:43-55`
- **问题描述**：只有命中 DB 元数据才用真实全量 md5；直接放进 `uploads/download` 目录的文件走 `calculatePartialMd5Async`（<10MB 全量，≥10MB 只取头 10MB + 尾 1MB）。前端把列表里的 md5 当作 `expectedMd5`，对合并后的完整文件算全量 md5 并严格比对。
- **影响**：这类 >10MB 文件每次合并都会报 `file md5 verification failed`，永远无法完成/导出；同时「部分 md5」与「全量 md5」共用同一字段，语义混乱。
- **建议修复方向**：列表只下发全量 md5，或显式标注 `md5Mode: "partial"`；前端仅在 full 模式下做终检。

### P2-9 秒传直接返回整行 `File` 记录，且 `user_id` 完全由请求体决定

- **位置**：`server/src/controllers/uploadController.js:211-219`、`:486`（另 `:339-340`）
- **问题描述**：`instantCheck` 以 `md5 + size + status=1` 全局查库（不带 user 维度），命中后原样返回 Sequelize 实例，JSON 序列化会带出 `file_path`（服务端物理路径）、`user_id`、`category_id`、`thumbnail_path` 等内部字段；上传/合并的 `user_id` 取自请求体且不校验，列表/下载也不做归属过滤。
- **影响**：知道 md5/size（列表接口就返回 md5）即可探测任意用户是否上传过该文件并取得内部元数据；多租户隔离不存在。
- **建议修复方向**：秒传按当前登录用户作用域查询，返回精简 DTO（`id/name/size/type/md5`）；`user_id` 由服务端身份推导，禁止请求体指定。

### P2-10 控制器把 `error.message` 原样回传，绕过统一错误脱敏

- **位置**：`server/src/controllers/uploadController.js:245, 275, 326`、`server/src/controllers/downloadController.js:321, 364, 454`
- **问题描述**：`app.js` 的 `errorHandler` 已按环境脱敏，但这 6 处直接 `jsonError(res, 500, error.message)`。
- **影响**：生产环境会把 fs 绝对路径（`ENOENT/EPERM/EACCES`）、SQL 报错、堆栈首行返回给客户端，泄漏部署结构。
- **建议修复方向**：统一 `next(error)` 交由 `errorHandler`，或返回固定文案、detail 只写日志。

### P2-11 库产物 external 漏掉 `react-dom/client`，产物残留 `process.env.NODE_ENV`

- **位置**：`vite.lib.config.ts:39-50`、`dist/useNetwork-*.js`（构建产物）
- **问题描述**：Rollup 的 `external` 数组是精确匹配，`"react-dom"` 不命中 `react-dom/client`，于是其 CJS 包装被内联进共享 chunk，模块体保留 `process.env.NODE_ENV` 判断。
- **影响**：在未注入该变量的运行时（原生 ESM/importmap、部分 SSR）打开 `message` / `Modal` / portal 会抛 `ReferenceError: process is not defined`；同时把 react-dom 的 dev/prod 分支固化进库产物。
- **建议修复方向**：external 补 `"react-dom/client"`（或改用 `/^react(-dom)?(\/.*)?$/` 正则），重建后断言 `dist/**` 不含 `process.env`。

### P2-12 发布的 `.d.ts` 引用了不存在的 `ui/ui.css`，关闭 `skipLibCheck` 的消费方会报 TS2307

- **位置**：`tsconfig.lib.json:11-16`、`dist/index.d.ts:1`（`upload.d.ts` / `download.d.ts` / `ui/index.d.ts` 同样）
- **问题描述**：入口源码的 `import "./ui/ui.css"` 被原样写入声明文件，但 Vite 把样式抽成 `dist/style.css`，`dist/ui/` 下只有 `.d.ts`，发布包中不存在 `ui/ui.css`。
- **影响**：消费方 `skipLibCheck: false`（tsc 默认值）时编译报 `Cannot find module './ui/ui.css'`。
- **建议修复方向**：构建后把 `ui/ui.css` 复制到 `dist/ui/`，或把样式副作用 import 移到不产生声明的入口，让 `.d.ts` 只保留 `declare module "*.css"`。

### P2-13 `--no-isolate` 全局关闭测试隔离，`vi.stubGlobal` 会跨文件泄漏

- **位置**：`package.json:56`、`vite.config.ts:11-21`
- **问题描述**：`vitest run --no-isolate` 让所有测试共享模块注册表与全局对象；多个 worker 测试使用 `vi.stubGlobal("fetch", ...)`，配置未开启 `unstubGlobals` / `restoreMocks`，`clearMocks` 只清调用记录不还原全局。
- **影响**：测试结果依赖文件执行顺序，单文件通过、全量失败（本项目已实际出现：`uploadWorkerBridge.test.ts` 需额外 `vi.resetModules()` 才能稳定）。
- **建议修复方向**：去掉 `--no-isolate`（`pool: "forks"` 已足够隔离）；如保留则同时开 `unstubGlobals` / `restoreMocks`，并在用例内成对 `vi.unstubAllGlobals()`。

### P2-14 `engines.node` 与实际工具链要求不符，peer 依赖未进入开发依赖

- **位置**：`package.json:17-19`、`:74-78`（peer）、`:79-100`（dev）
- **问题描述**：`engines.node: ">=20.0.0"` 允许 Node 20.0–20.18 通过安装校验，但 vite 7 要求 `^20.19.0 || >=22.12.0`、vitest 5 要求 `^22.12.0 || ^24 || >=26`；`react` / `react-dom` / `zustand` 只在 peer 中声明，本地依赖 npm 自动安装（`react@18.3.1`），`@types/react` 锁定 18 而 peer 声称支持 `^19`。
- **影响**：低版本 Node 安装成功但 build/test 直接失败；React 19 组合从未被任何脚本验证。
- **建议修复方向**：`engines.node` 收敛为 `"^22.12.0 || >=24"`；把 react/react-dom/zustand 显式加入 `devDependencies`；增加 React 19 的 CI 组合，或把 peer 范围收敛到 18。

### P2-15 merge worker 合并成功后不清分片，与主线程路径策略矛盾

- **位置**：`src/components/ZustandFileDownload/services/downloadEventHandlers.ts:83-95`、`src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts:176-179`
- **问题描述**：`handleMergeComplete` 写入 `completeFileStore` 并标记完成后直接返回，没有 `removeAllChunks`；只有主线程兜底路径（`mergeInMainThread` 之后）才清分片。
- **影响**：走 merge worker 的合并会长期同时保留 chunks 与 completeFiles，占用双份配额且没有后续清理点。
- **建议修复方向**：在 `handleMergeComplete` 内统一清理分片，与主线程路径保持一致。

---

## 六、P3 问题

### P3-1 构建配置自身没有类型门禁，且存在无效配置项

- **位置**：`tsconfig.node.json:21`、`tsconfig.json:3-7`、`vite.lib.config.ts:35`、`:52-57`
- **问题描述**：`vite.lib.config.ts`（真正的发布构建配置）不在 `tsconfig.node.json` 的 `include` 中，`tsconfig.lib.json` 也不在根 `references` 里，`tsc -b` 只检查 demo 用的 `vite.config.ts`；`build.sourcemap: false` 使 npm 包没有 sourcemap；`output.globals` 只对 UMD/IIFE 生效，而 formats 只有 `es`/`cjs`。
- **影响**：发布构建配置的类型错误无人发现；线上问题只能靠压缩产物猜行号；存在误导性配置。
- **建议修复方向**：`tsconfig.node.json` 的 `include` 增加 `vite.lib.config.ts`；`tsconfig.lib.json` 加入根 `references`；发布 ESM 开启 `sourcemap`（或 `hidden`）；删除 `output.globals`。

### P3-2 包元数据、公共导出面与 CHANGELOG 互不一致

- **位置**：`package.json:7-16`、`:23-40`、`src/index.ts:27-32`、`src/download.ts:17-23`、`CHANGELOG.md:8/46`
- **问题描述**：①缺 `repository` / `homepage` / `bugs` / `author`；`keywords` 仍含 `"antd"`，与「零 UI 依赖」矛盾。②根入口把运行时对象 `DownloadStatus` 以 `export type` 导出，消费方拿不到该枚举；同时缺 `DownloadConfig` / `StorageStats` / `DownloadStatusType`，与 `/download` 子入口不对齐。③`exports` 没有 `"./package.json"`。④version 为 `3.0.1`，但 CHANGELOG 无 `[3.0.1]` 段。
- **影响**：npm 页面无仓库入口；类型使用者从主入口拿不到必要类型；部分工具链读取元数据失败；发布记录与实际版本脱节。
- **建议修复方向**：补齐元数据并清理关键词；统一根/子入口导出；`exports` 增加 `"./package.json": "./package.json"`；发布前把 `Unreleased` 切成 `[3.0.1]`。

### P3-3 单测全部运行在 jsdom + fake-indexeddb，没有浏览器级断言

- **位置**：`vite.config.ts:11-19`、`server/e2e/smoke.mjs:1-14`
- **问题描述**：`?worker&inline`（Blob Worker）、`Blob.slice` 惰性读取、`URL.createObjectURL` 导出、`navigator.storage.estimate`、`Content-Range` 206 等路径在 jsdom 下只能靠 mock；`test:e2e` 是 Node 直接打服务端 API，不经过浏览器与 Worker。`playwright` 已在 devDependencies，但只用于 README 截图脚本。
- **影响**：worker 与浏览器存储的真实行为缺少运行证据，P0-1 这类缺陷无法被现有测试捕获。
- **建议修复方向**：复用已有 playwright 增加 1 条真实浏览器冒烟（小文件：分片上传 → 合并 → 分片下载 → md5 比对），纳入 CI 并与 `verify` 串联。

---

## 七、整体优先级建议

**第一批（立即修，发布前必须完成）**

1. P0-1 下载完成不合并 —— 核心功能不可用，改动集中在一个 handler，风险低收益最高。
2. P0-2 `md5` 路径穿越 + P0-3 Cookie 鉴权绕过 —— 两处都是小改动（正则校验 + 路径断言 / fail-closed），但安全影响最大。
3. P1-5 样式 exports、P1-6 依赖漏洞 —— 直接影响消费方接入与 CI，修复成本以分钟计。

**第二批（本迭代内完成，目标是把主链路做稳）**

- P1-1 / P1-3 / P2-6 / P2-7：下载侧并发与状态一致性，建议作为一组统一重构「下载完成 → 校验 → 合并 → 清理」的状态机。
- P1-2 / P1-4：服务端落盘原子性与配额，建议同时引入 `.part` 临时文件与按 file 的配额登记。
- P1-8 / P2-1：上传侧任务超时与按需计算分片 MD5，直接决定大文件体验。
- P1-7：把覆盖率纳入 `verify`，并为下载链路补 `renderHook` 用例——这是防止上述问题回归的前提。

**第三批（后续迭代，工程化与体验）**

- P2-2 / P2-3 / P2-4 / P2-5 / P2-8 / P2-9 / P2-10 / P2-11 / P2-12 / P2-13 / P2-14 / P2-15
- P3 全部

**验收建议**：每批完成后跑 `eslint .` + `tsc -b` + `npm run test:unit` + `npm run test:e2e`，并至少保留一条「上传 → 下载 → 导出 → md5 一致」的端到端用例作为回归基线。

---

## 附录：审计中实际执行的核查

| 核查项 | 结果 |
| --- | --- |
| `eslint .` | 通过 |
| `tsc -b --force` | 通过（app / node / test 三个子项目） |
| `npx tsc -p tsconfig.test.json --noEmit` | 0 错误 |
| `npm --prefix server test` | 39/39 通过 |
| `npm run test:unit` | 136/136 通过 |
| `vitest --coverage` | 通过，lines 41.03 / statements 40.73 / functions 32.36 / branches 30.18 |
| `npm ls --depth=0` | 无缺失 peer、无重复版本 |
| `npm audit --omit=dev` | high 1（`follow-redirects@1.16.1`） |
| `npm pack --dry-run` | 成功，入包 100 个文件 |

> 说明：本报告结论均来自静态代码与上述命令；未启动服务进行端到端复现，因此不包含依赖运行时环境（如 `req.on("close")` 的具体触发时机、特定 Node 版本行为）的推断性结论。

---

## 八、核验结论与修复状态（2026-11-06 复核）

### 8.1 核验方式

逐条打开磁盘代码对照行号复核，并实跑：`npm audit --omit=dev`、`node --test`（Node 24.13.1）、`vitest run --no-isolate`、`npm run build`、`node e2e/smoke.mjs`、`require.resolve` 包自引用。

### 8.2 总体结论

**29 条问题全部真实存在，无捏造**：26 条完全确认，3 条核心缺陷成立但描述需修正。

| 编号 | 原描述偏差 | 实际情况 |
| --- | --- | --- |
| P0-3 | 称「鉴权完全失效 / fail-open」 | 缺陷本体成立（Cookie 有值即通过）；但无 Cookie 时仍 401，属「Cookie 值不校验」而非整体 fail-open。当前代码已有 fail-closed 基础，缺的是 Cookie 值校验。 |
| P1-4 | 称「MAX_CHUNKS 仅在 merge 校验」 | `MAX_CHUNKS` 在 `/upload` 也用于 `index` 范围校验（且有测试）；但「累计字节/累计分片数无配额」成立，DoS 结论不变。 |
| P2-9 | 把「`user_id` 由请求体决定」挂在 `instantCheck` 名下 | `instantCheck` 不读 `user_id`；问题实际发生在 `uploadChunk` / `mergeChunks`。多租户隔离缺失的结论成立。 |

其他精度修正（不影响判定）：

- **P2-6**：worker 已有文件级 `retryAttempts` 守卫与 `allChunksExceededRetries` 守卫，「全部失败分片超限」会先发 `ERROR`；误发 100% + `COMPLETE` 只在「混合批 + 文件级计数被清零」的特定时序成立。
- **P1-3**：`getPendingChunks` 实际位于 `services/chunkPersistenceService.ts:114-126`（非 `downloadPolicy.ts`）；内存 store 的 `chunkSize` 会被覆盖，IndexedDB 侧在再次 `startDownload` 时才写回。
- **附录覆盖率数字已过时**：现存 `coverage/coverage-summary.json` 为 lines 38.67 / statements 38.64 / functions 32.67 / branches 30.35；「下载侧核心文件 0%」结论不变。
- **P0-2 影响补充**：`mergeChunks` 的 catch 会 `unlink(targetPath)`，越界时不仅可写、还可删除 `UPLOADS_DIR` 之外的文件。

### 8.3 已修复（第一批，2026-11-06）

| 编号 | 修复内容 | 验证 |
| --- | --- | --- |
| P0-1 | `COMPLETE` → 先合并（merge worker，缺失回退主线程）→ 写 `completeFileStore` → 再清分片 | 单测断言 `mergeFile` 被调用、不再直接 `markCompleted` |
| P1-1 | 主线程按 `fileId` 串行化落盘，`COMPLETE` 前 await 全部落盘 | 生命周期改造，单测全绿 |
| P2-5（部分） | 落盘失败不再静默：记录原因并在 `COMPLETE` 时按 `ERROR` 上报 | 同上 |
| P2-7 | `startDownload` 增加重入守卫（`resume` 显式 `force`） | 类型/单测通过 |
| P2-15 | `handleMergeComplete` 补分片清理 | 单测断言 `removeAllChunks` |
| P0-2 | `md5` 强制 `^[a-f0-9]{32}$`；落盘路径 `resolveInsideBase` 断言 | 新增 2 条 400 用例；e2e 正常上传/合并通过 |
| P0-3 | Cookie 必须命中 `FILE_AUTH_COOKIE_TOKENS` 或 `verify`；未配置白名单时启动告警并一律 401 | 新增 2 个 app 级测试文件 + 中间件用例 |
| P1-5 | `exports` 增 `./dist/style.css`；README/注释统一为 `.../style.css` | `require.resolve` 两种写法均成功 |
| P1-6 | `overrides.follow-redirects ^1.16.2`，lock 同步 | 本机代理 502 无法连 audit endpoint；`npm ls --package-lock-only` 显示 1.16.2，待 CI 联网验证 |
| P2-13 | `test:unit` 去掉 `--no-isolate`（`pool: forks` 已够隔离） | 实测同一提交下 173/173 与 170/173 交替；改后连续 173/173 |
| — | 顺带修复两个 worker 测试的既有 `tsc` 类型错误（`postedMessages.push(unknown)`） | `tsc -b --force` 0 错误 |

### 8.4 已修复（第二批，2026-11-06）

| 编号 | 修复内容 | 验证 |
| --- | --- | --- |
| P1-2 | 合并改为 staging 落盘：`TMP_UPLOAD_DIR/<storedName>.<fileId>.part` 追加写入，size 与 md5 全部校验通过后才 `rename` 原子移入 `UPLOADS_DIR`（跨卷退化为 copy+unlink）；失败路径同时清理 staging 与目标 | 新增 2 条用例：校验失败后 uploads 无半成品且 tmp 无残留；成功后文件长度正确、tmp 无 `.part` |
| P1-8 | 上传任务新增「静默看门狗」`idleTimeoutMs`（默认 120s，传 0 关闭）：worker 期间任意消息刷新计时，超时判定失联 → 销毁 worker 并以错误结束任务（可重试续传），不再永久停在 UPLOADING | 新增 2 条桥接用例：长时间无消息报错且 worker 被 terminate、不回池；持续进度不被误杀 |
| P2-1 | 秒传快路径前置：先不带 `chunk_md5s` 发一次轻量 instant 校验，命中即结束（一个分片哈希都不用算）；分片 MD5 由单条串行改为有界并发（`min(chunkConcurrency, 4)`），并输出批次进度日志 | 单测 175/175；既有 pause/cancel/debug 用例语义不变 |
| P2-6 | 新增 `completedChunks` 集合；`remainingChunks` 为空时显式核对是否真的拿齐全部分片，缺片则发 `ERROR`（带缺失索引），不再伪造 100% 进度与 `COMPLETE` | 既有 retry 用例仍通过（「全部超限」路径行为不变） |
| P1-3 | 分片方案固化：`fetchDownloadFiles` 沿用已有文件的 `chunkSize`，并保留 `progress`/`status`（不再把进行中的下载重置为 IDLE）；`startDownload` 以 IndexedDB 中持久化的 `chunkSize` 为基准 | 单测全绿；`normalizeDownloadFile` 保持纯函数，未引入 IO |
| P1-7 | 新增 `test:coverage` 脚本并接入 `verify:client`，本地门禁与 CI 使用同一套覆盖率阈值 | `npm run test:coverage` 退出码 0（lines/statements 35、functions 30、branches 25 及分组阈值均达标） |

### 8.5 已修复（第三批，2026-11-06）

| 编号 | 修复内容 | 验证 |
| --- | --- | --- |
| P1-4 | `uploadChunk` 增加按 `file_id` 的累计配额（首次从磁盘播种、覆盖写按差额计费、合并/重置后失效）：累计字节超 `MAX_UPLOAD_SIZE_MB` → 413，片数超 `MAX_CHUNKS` → 400 | 新增 2 条用例：第三片超累计字节被拒；重复 index 覆盖写不重复累加 |
| P2-2 | 新增 `isUploadInFlight`（QUEUED / QUEUED_FOR_UPLOAD / PREPARING_UPLOAD / UPLOADING / PAUSED）：倒计时期间重新上传的文件既不从 UI 移除也不删 DB，并从待清理集合移除 | 新增用例：倒计时中变回 UPLOADING → 不删、不消失、`pendingCount()===0` |
| P2-3 | `validateFiles` 改为「已有文件数 + 本次数量」与 `maxFiles` 比较，提示中带已有数量 | 单测全绿（该 hook 无既有用例，逻辑随实现审查） |
| P2-4 | 新增 `uploadSchema.ts`（`UPLOAD_SCHEMA_VERSION = 2`）：写入统一盖章版本（`createUploadStorage` 包装 `setItem`），读取经 `migrateUploadFile` 补字段、裁剪进度、映射历史状态字符串；未知状态降级为 PAUSED，结构性损坏丢弃 | 新增 7 条迁移用例 + 1 条重新上传保留用例 |
| P2-5（补齐） | `saveChunkWithRetry` 对配额错误不再无意义重试 3 次（直接失败）；`startDownload` 落盘前用 `navigator.storage.estimate()` 预检，空间不足直接给出明确原因而不是最后报「分片不完整」 | 新增 5 条配额预检用例 |
| P2-8 | 列表新增 `md5Mode`（`full`/`sample`）：无 DB 元数据的 ≥10MB 文件标记 `sample`，客户端识别后跳过合并终检的严格比对；`<10MB` 仍为全量 md5 严格校验 | 新增用例：列表每条都带 `md5Mode`；`getPartialMd5Mode` 阈值边界 |
| P2-9 | 秒传 / 已合并响应改为白名单 DTO，只回 `file_id`/`file_name`/`size`/`md5`/`file_ext`/`file_type`/`category_id`/`created_at` | 新增用例：命中响应不含 `user_id`/`file_path`/`thumbnail_path`，且 DB 中确实存在这些字段（排除真空断言） |
| P2-10 | 6 处 `jsonError(res, 500, error.message)` 与合并 catch 统一走 `redactErrorMessage`：非 test/development 只返 `internal server error`，业务 4xx 文案保持原样 | 新增用例：production 脱敏、test 保留原文 |
| P2-11 | `external` 改为前缀匹配 `/^(react\|react-dom\|zustand\|localforage\|axios)(\/.*)?$/`，覆盖 `react-dom/client` 等子路径 | 构建后 `grep process.env dist` 无命中；`react-dom/client` 以裸导入形式 external |
| P2-12 | 新增 `scripts/strip-dts-css-imports.mjs` 并接入 `build`，剔除 `.d.ts` 中的 CSS 副作用导入 | 构建日志：85 个 `.d.ts` 中 4 个被清理；`grep .css dist/**/*.d.ts` 无命中 |
| P2-14 | `engines.node` → `^22.12.0 \|\| >=24.0.0`；`react`/`react-dom`/`zustand` 同时进 `devDependencies` | 版本声明与 vite 7 / vitest 5 的 engines 求交后一致 |
| P3-1 | `tsconfig.node.json` 纳入 `vite.lib.config.ts`；新增 `tsconfig.lib.check.json` + `npm run typecheck`（noEmit 校验库入口）；移除对 ESM/CJS 无效的 `output.globals` | `tsc -b` 与 `tsc -p tsconfig.lib.check.json` 均 0 错误 |
| P3-2 | 补 `repository`/`homepage`/`bugs`/`author`，删 `keywords.antd`；`exports` 增 `"./package.json"`；根入口改为值导出 `DownloadStatus` 并补 3 个类型；CHANGELOG 补 `[3.0.1]` 段 | `require.resolve('react-upload-indexeddb/package.json')` 通过；类型检查确认值导出合法 |
| P3-3 | 新增 `npm run test:browser`：真实 Chromium + vite dev + 临时服务端，选 2.5MB 文件后轮询列表校验 `fileName`/`size`/`md5` | 本地实测通过（`browser-e2e-*.bin` md5 一致）；未接入 CI（CI 无浏览器） |

### 8.6 结论

报告中 29 条问题**全部成立**，且已全部修复或有明确决策：

- **28 条已修复**（P0×3、P1×8、P2×15、P3×3 中的 P3-1/P3-2/P3-3 均落地）；
- **1 条保持观察**：P1-6（`follow-redirects` 已通过 `overrides` + lock 同步到 1.16.2，但本机 npm 代理 502 无法跑 `npm audit`，需 CI 联网后确认退出码为 0）。

### 8.7 验证结果（第三批后）

| 核查项 | 结果 |
| --- | --- |
| `npx tsc -b --force` | 0 错误 |
| `npx tsc -p tsconfig.lib.check.json` | 0 错误（新增库入口门禁） |
| `npx eslint .` | 0 error（15 warning，均为既有 `no-explicit-any`） |
| `npm run test:unit` | 188/188 通过（33 个文件） |
| `npm run test:coverage` | 通过，阈值全达标 |
| `node --test`（Node 24.13.1，`--test-force-exit`） | 72/72 通过 |
| `node e2e/smoke.mjs` | 通过（上传→合并→Range 下载→整文件下载→md5 一致） |
| `npm run test:browser`（Node 24 + Chromium） | 通过（真实 Worker + IndexedDB + 服务端，md5/体积一致） |
| `npm run build` | 通过；dist 无 `process.env`、无 `.css` 的 d.ts 导入 |
| `npm audit --omit=dev` | 本机网络不可达（代理 502），待 CI 联网复验 |
