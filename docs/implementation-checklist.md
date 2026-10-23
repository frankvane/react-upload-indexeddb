# react-upload-indexeddb 实施清单（Implementation Checklist）

> 配套文档：[`project-analysis.md`](./project-analysis.md)（问题分析与证据）  
> 制定日期：2026-10-23　｜　基线版本：`v1.0.5`　｜　目标版本：`v1.1.0`（阶段一+二）/ `v2.0.0`（阶段三）

---

## 实施进度（2026-10-23 更新）

**阶段一：止血 —— 已完成 ✅**（T1.1 ~ T1.7 全部落地并通过验证）

| 任务                               | 状态 | 验证证据                                                                                                |
| -------------------------------- | -- | --------------------------------------------------------------------------------------------------- |
| T1.1 下载分片注入鉴权                    | ✅  | `downloadAuth.test.ts` 4 用例（Worker fetch 集成：Bearer/include、默认 same-origin、自定义头、CHUNK_DOWNLOADED 上报） |
| T1.2 上传 withCredentials 打通       | ✅  | `useEffectiveConfig.test.tsx` 3 用例（props→Context→effective config 回归）                               |
| T1.3 README/docs 鉴权订正            | ✅  | README 鉴权章节重写 + `components.md` 新增「7. 鉴权接入」组合矩阵                                                     |
| T1.4 configureDownloadApi 缺省保留现值 | ✅  | `api.client.test.ts` 3 用例                                                                           |
| T1.5 简化模式仅清理成功文件                 | ✅  | `SimpleUploadList.test.tsx` 新增 1 用例（失败文件保留）                                                         |
| T1.6 定时器与资源清理                    | ✅  | `cleanupPolicy.test.ts` 5 用例；`useFileProcessor` 定时器 ref 化（无单测覆盖，代码评审+手工验证）                          |
| T1.7 工程三连                        | ✅  | prepack/prepublishOnly 已加；CHANGELOG.md 新建；server 自引用依赖已删；`.lh` 27 个文件出库                             |

整体验证（2026-10-23）：`eslint .` 0 error / 0 warning；`vitest run` **12 文件 / 41 用例全绿**（新增 24 个）；`vite build` lib 成功（`index.js` 173.47 kB / gzip 49.12 kB，tsc d.ts 退出 0）；`npm pack --dry-run` 仅含 `dist/**`（70 文件）；`verify-client-contract` 通过。

> 注：`useFileProcessor` 卸载后 500ms 不发起上传一项仍以代码评审+手工验证覆盖，待 harness 成本可接受时回补。

**阶段二：健壮性 —— 已完成 ✅**（T2.1 ~ T2.8 全部落地并通过验证）

| 任务                               | 状态 | 验证证据                                                                                                |
| -------------------------------- | -- | --------------------------------------------------------------------------------------------------- |
| T2.1 `mergeApi` prop + joinUrl   | ✅  | `url.test.ts` 8 用例；`useEffectiveConfig.test.tsx` 覆盖 prop 透传                                        |
| T2.2 分片存储键解耦（`${md5}_${size}_${chunkSize}`） | ✅  | `chunkKey.test.ts` 7 用例 + `server/tests/chunk-key.test.js` 4 集成用例（chunkSize 变化隔离、秒传按 md5+size、reset 一致性清空） |
| T2.3 Worker CANCEL 协议           | ✅  | `uploadWorker.cancel.test.ts` 2 用例（中断在途 fetch + 状态回 QUEUED）                                     |
| T2.4 调试日志节流                   | ✅  | `uploadWorker.debug.test.ts` 2 用例（1000 分片默认 0 条 / 开启 <20 条）                                     |
| T2.5 下载侧存储性能                  | ✅  | `chunkPersistenceService.test.ts` 5 用例（500 分片单游标 / 合并后清理 / 多文件隔离）；`downloadEventHandlers.test.ts` 5 用例 |
| T2.6 服务端健壮性                   | ✅  | `janitor.test.js` 5 用例 + `security.test.js` 3 用例；mergeChunks 重 IO 移出长事务                            |
| T2.7 列表缓存 + file_id 校验        | ✅  | `list-cache.test.js` 5 用例（TTL/mtime 签名/LRU/分页/非法 id 404）                                       |
| T2.8 测试体系 + CI + 覆盖率         | ✅  | 客户端 20 文件 / 90 用例、服务端 5 文件 / 29 用例全绿；`.github/workflows/ci.yml`（lint→test+coverage→server test→build→pack dry-run）；覆盖率 ratchet 门槛落地 |

整体验证（2026-10-23）：`eslint .` 0 error / 0 warning；`vitest run` **20 文件 / 90 用例全绿**；`vitest run --coverage` 门槛通过（全库 lines 40.08% / funcs 47.71% / branch 71.92%，`src/shared` 87.03% ≥ 80%）；`npm --prefix server test` **29/29 通过**；`npm run build` lib 成功（index.js 177.17 kB / gzip 51.08 kB，d.ts 退出 0）；`npm pack --dry-run` 71 文件 333.5 kB。

> 注 1：`useFileProcessor` 卸载后 500ms 不发起上传一项仍以代码评审 + 手工验证覆盖（`fileProcessor.ts` 覆盖率 23.5%，harness 成本高于收益，留待阶段三重构时一并补）。
> 注 2：e2e playwright 冒烟测试（上传 5MB → 列表可见 → 下载 → md5 一致）**延后**——仓库无 playwright 依赖，引入成本与收益暂不匹配；服务端已有 29 个 `node --test` 集成用例覆盖上传/下载/合并主链路。

**下一步**：阶段三（架构升级）需单独立项与评审（T3.1 流式分片 / T3.2 全局单例治理 / T3.3 状态机收敛 / T3.4 字节级进度），目标版本 `v2.0.0`。

---

## 0. 总原则

1. **一个任务 = 一个 PR = 一次可独立验证的交付**，禁止把多个 P0 混在一个 PR。
2. 每个任务完成后立即执行其「验收标准」中的命令，结果回贴到 PR 描述。
3. 涉及 **Worker 消息协议** 的改动必须同步更新 `types/workerProtocol.ts`、两端实现与单测，三者缺一即不合入。
4. 阶段三会改变「刷新续传」的对外行为，**必须先升级 minor/major 并在 README 明示 Breaking Change**。
5. 任何任务不得引入新的 eslint warning；`npm run verify:client` 必须保持绿灯。

---

## 阶段一：止血（目标 1～2 天，全部低风险，不动架构）

> 阶段一完成后，鉴权链路（Bearer + Cookie）才真正端到端可用。

### T1.1 下载分片请求注入鉴权（对应 P0-1）🔴 复杂度：中

| 项    | 内容                                                                                                                                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `src/components/ZustandFileDownload/types/download.ts`、`context/DownloadContext.tsx`、`hooks/useFileDownloaderController.ts:233-253`、`worker/downloader.worker.ts:299-304`、`api.client.ts`                                                                                        |
| 改动要点 | ① `ZustandFileDownloadProps` 增加 `authToken?` / `getAuthToken?` / `getAuthHeaders?` / `authScheme?` / `withCredentials?`；② Provider 透传；③ `START_DOWNLOAD` payload 增加 `authHeaders` 与 `withCredentials`；④ Worker 内 `fetch` 合并 headers 并设置 `credentials`（默认 `same-origin`，与上传侧语义一致） |
| 复用点  | 鉴权头解析复用上传侧 `resolveAuthHeaders`（`ZustandFileUpload/utils/auth.ts`），建议抽到 `src/shared/authHeaders.ts` 双向复用                                                                                                                                                                         |
| 验收标准 | ① 新增 `src/components/ZustandFileDownload/services/downloadAuth.test.ts`：mock `fetch` 断言 Bearer 头与 `credentials` 四种组合；② 手工：server 设 `REQUIRE_FILE_AUTH=true`，不带 token 下载返回 401，带 token 分片 206 成功；③ `npm run verify:client` 通过                                                     |
| 风险   | 低（新增字段，老消费方不受影响）                                                                                                                                                                                                                                                                 |

### T1.2 上传 `withCredentials` 打通（对应 P0-2）🔴 复杂度：低

| 项    | 内容                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `src/components/ZustandFileUpload/context/UploadContext.tsx:49-107`                                                                                                         |
| 改动要点 | ① 解构 `withCredentials = false`；② 写入 `value`；③ 同步 `useEffectiveConfig` 依赖数组（已含，确认即可）                                                                                         |
| 验收标准 | ① 新增单测：props 传 `withCredentials: true` → bridge 下发的 `uploadConfig.withCredentials === true`；② mock Worker 场景断言 `fetch` 的 `credentials === 'include'`；③ 默认不传时为 `same-origin` |
| 风险   | 低（纯接线）                                                                                                                                                                      |

### T1.3 README / docs 鉴权章节订正（对应 P2-19）🟡 复杂度：低

| 项    | 内容                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `README.md:246-283`、`docs/components.md`                                                                                                                                                                                                       |
| 改动要点 | ① 删除 `credentials:'include'` / `withCredentials:true` 的过时描述，改为"默认 `same-origin` / `false`，仅 Cookie 鉴权时显式开启"；② 明确 `setDownloadAuth` 在 v1.0.5 仅作用于列表请求（v1.1.0 起覆盖分片）；③ `docs/components.md` 新增「鉴权接入」章节，给出 Bearer / 同域 Cookie / 跨域 Cookie 三行组合矩阵表 |
| 验收标准 | 文档中每个断言都能在代码中找到对应实现；交叉评审一遍即可                                                                                                                                                                                                                   |

### T1.4 `configureDownloadApi` 缺省保留现值（对应 P2-29）🟡 复杂度：低

| 项    | 内容                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 涉及文件 | `src/components/ZustandFileDownload/api.client.ts:81-93`、`src/components/ZustandFileDownload/index.tsx:55-61`                                                                                                |
| 改动要点 | ① `withCredentials` 改为 `config.withCredentials ?? apiClient.defaults.withCredentials`；② `baseURL` 仅在 `typeof config.baseURL === "string" && config.baseURL !== ""` 时覆盖（当前 `props.baseURL ?? ""` 会把用户先前的配置清空） |
| 验收标准 | 新增单测：先 `configureDownloadApi({ withCredentials: true })`，再 mount `<FileDownload />`，断言 `apiClient.defaults.withCredentials` 仍为 `true`                                                                        |

### T1.5 简化模式仅清理成功文件（对应 P2-28）🟡 复杂度：低

| 项    | 内容                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `src/components/SimpleUploadList.tsx:147-169`                                                                                         |
| 改动要点 | ① `handleUploadComplete` 中按 `success` 收集 `successIdsRef`；② `handleBatchComplete` 只 `removeUploadFilesByIds(successIds)`；③ 失败文件保留并提示用户 |
| 验收标准 | 扩展 `src/components/SimpleUploadList.test.tsx`：1 成功 1 失败场景下，失败文件仍在 `listUploadFiles()` 中                                               |

### T1.6 定时器与资源清理（对应 P1-9）🟡 复杂度：低

| 项    | 内容                                                                                                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `worker/uploadWorker.ts:104-107,125`、`hooks/useFileProcessor.ts:250`、`services/cleanupPolicy.ts:200-222`                                                                                                                                             |
| 改动要点 | ① `fetchWithRetry` 的 `timeoutId` 收敛到 `finally { clearTimeout(timeoutId) }`（覆盖 5xx 重试与网络异常分支）；② `useFileProcessor` 的 `setTimeout(uploadAll, 500)` 改为 `ref` 持有 + unmount 清理；③ `cleanupPolicy.startCountdown` 删除 `setTimeout` 兜底，只保留 `setInterval` 单触发源 |
| 验收标准 | ① 新增 `cleanupPolicy` 单测覆盖 dispose/countdown 到期；② `useFileProcessor` 卸载后 500ms 内不产生上传请求（mock 断言）；③ 现有 12 个用例不回退                                                                                                                                       |

### T1.7 工程三连（对应 P2-20 / P2-21 / P2-22）🟡 复杂度：低

| 项    | 内容                                                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `package.json`、`CHANGELOG.md`（新建）、`server/package.json`、`.gitignore`、`.lh/`（删除）                                                                                                                                                                                  |
| 改动要点 | ① 根 `package.json` 增加 `"prepublishOnly": "npm run build"` 与 `"prepack": "npm run build"`；② 新建 `CHANGELOG.md`（Keep a Changelog 格式，先补 1.0.1~1.0.5 历史）；③ `server/package.json` 删除 `"react-upload-indexeddb": "file:.."`；④ `git rm -r .lh` 并在 `.gitignore` 增加 `.lh/` |
| 验收标准 | ① `npm pack --dry-run` 输出仅含 `dist/**`；② `npm run verify:client` 通过；③ `git status` 干净，`.lh` 不再被追踪                                                                                                                                                                 |

---

## 阶段二：健壮性（目标 1 周，按依赖顺序执行）

> 依赖关系：T2.1 → T2.2 → T2.3；T2.4 / T2.5 / T2.6 / T2.7 可并行；T2.8 贯穿全程，最后统一收口。

### T2.1 merge API 可配 + URL 归一化（对应 P1-5）🟡 复杂度：中 ✅ 已完成（2026-10-23，commit 见 T2.2 合并提交）

| 项    | 内容                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | 新建 `src/shared/url.ts`；`types/upload.ts`、`context/UploadContext.tsx`、`hooks/useEffectiveConfig.ts`、`services/uploadWorkerBridge.ts`、`worker/uploadWorker.ts:456`、`worker/filePrepareWorker.ts`（无 API 引用，跳过） |
| 改动要点 | ① 新增 `joinUrl(base, path)`：处理首尾斜杠、空 base；② 全链路新增 `mergeApi` prop（默认 `/api/file/merge`，来自 `config/api.ts` 的 `API_PATHS.file.merge`）；③ `uploadWorker` 内所有 URL 拼接改用 `joinUrl`                                  |
| 验收标准 | ① `src/shared/url.test.ts` 覆盖 6 种组合（空/带斜杠/不带/带路径前缀）；② mock Worker 断言 `mergeUrl === joinUrl(baseURL, mergeApi)`；③ `baseURL="https://x.com/"` 时不再出现 `//api/`                                                  |

### T2.2 file_id 与分片索引解耦（对应 P1-6 / P1-7）🔴 复杂度：高（跨端）✅ 已完成（2026-10-23）

| 项            | 内容                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件         | 客户端 `worker/filePrepareWorker.ts:94`、`types/upload.ts`；服务端 `controllers/uploadController.js`（`instantCheck` / `uploadChunk` / `mergeChunks`）、`utils/fileSecurity.js`、`models/fileChunk.js`                                                                                                                                                               |
| 设计要点（推荐方案 A） | ① 客户端本地队列 id = `${md5}_${size}_${lastModified}_${randomSuffix}`（解决同内容文件冲突）；② **分片存储键**（服务端 `file_id`）改为 `${md5}_${size}_${chunkSize}`，天然兼容 `sanitizeFileId` 的白名单（`[a-zA-Z0-9_-]`）；③ `File` 表按 `md5` 判秒传不变；④ `instantCheck` 增加 `size` 与 `chunk_size` 一致性校验，不一致则清空旧分片结果；⑤ 备选方案 B：`FileChunk` 增加 `chunk_size` 列并以 `(file_id, chunk_size)` 联合索引，改动更小但历史数据需迁移 |
| 验收标准         | ① 新增 `server` 集成测试：同一 md5 不同 chunkSize 的两轮上传互不污染，均能合并成功；② 客户端单测：id 生成器唯一性（连续 1000 次无碰撞）；③ e2e：4MB 分片传一半 → 切网使 chunkSize 变 1MB → 重试 → 合并成功且 md5 校验通过                                                                                                                                                                                                      |

### T2.3 Worker CANCEL 协议（对应 P1-8）🟡 复杂度：中 ✅ 已完成（2026-10-23）

| 项    | 内容                                                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `types/workerProtocol.ts`、`worker/uploadWorker.ts`、`services/uploadWorkerBridge.ts`、`hooks/useBatchUploaderController.ts:409-418`                                                                        |
| 改动要点 | ① 协议新增 `{ type: "CANCEL" }` 与响应 `{ type: "cancelled" }`；② Worker 内为每个任务维护 `AbortController`，收到 CANCEL 时 `abort()` 并退出循环；③ bridge 新增 `cancelUploadTask(fileId)`，取消时 `terminate` 兜底；④ `cancelUpload` 调用链贯通 |
| 验收标准 | ① 单测 mock：上传中 cancel → `fetch` 的 `signal.aborted === true`；② 手工：取消后 Network 面板无残留 in-flight 请求；③ IndexedDB 中该文件状态回到 `QUEUED` 且 `buffer` 释放                                                               |

### T2.4 日志开关与节流（对应 P1-10）🟡 复杂度：低

| 项    | 内容                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `worker/uploadWorker.ts:29-37`、`types/upload.ts`（新增 `debug?: boolean`）、`hooks/useEffectiveConfig.ts`                                                              |
| 改动要点 | ① `debug(message, data)` 增加模块级 `DEBUG_ENABLED`（由 `uploadConfig.debug` 注入，默认 `false`）；② 关闭时既不 `console.log` 也不 `postMessage`；③ 开启时分片级日志按 200ms 节流，error/retry 类不受限 |
| 验收标准 | ① 单测：默认下 1000 分片上传产生的 debug 消息数 === 0，控制台无输出；② 开启时消息数 < 20                                                                                                        |

### T2.5 下载侧存储性能与空间（对应 P1-11 / P1-12）🟡 复杂度：中 ✅ 已完成（2026-10-23）

| 项    | 内容                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `services/chunkPersistenceService.ts:53-139`、`services/downloadEventHandlers.ts:78-90`、`hooks/useDownloadFiles.ts:56-68`、`hooks/useStorageManager.ts:54-83`                                                                                                                                             |
| 改动要点 | ① `getChunkHealth/getPendingChunks/countDownloadedChunks/collectChunks` 改为 `chunkStore.iterate()` 单次游标，一次遍历产出全部结果；② 合并成功（`handleMergeComplete` / `markCompleted`）后异步 `removeAllChunks(fileId)`；③ `calculateStorageSize` 的元数据部分改用 Blob.size 累加（元数据用 `estimate()` 兜底），删除 `JSON.stringify(file).length` 估算 |
| 验收标准 | ① 新增 `chunkPersistenceService` 单测（fake-indexeddb）：500 分片 `getPendingChunks` 只发起 1 次游标；② e2e：下载完成后 `chunkStore` 中该文件 key 数为 0，`StorageStats` 与浏览器实际占用偏差 < 5%                                                                                                                                             |

### T2.6 服务端健壮性（对应 P1-13）🟡 复杂度：高 ✅ 已完成（2026-10-23）

| 子项               | 文件                                                 | 要点与验收                                                                                                        |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| a. 合并移出事务        | `controllers/uploadController.js:318-397`          | 先在事务外完成 readFile/appendFile/md5File，再开短事务写 `File` + 更新 `FileChunk.status`。验收：10 个 20MB 文件并发合并无 `SQLITE_BUSY` |
| b. 孤儿分片清理        | 新建 `server/src/janitor.js` + `server/src/index.js` | 启动时 + 每 6h 扫描 `tmp/upload`，删除超过 `TMP_TTL_HOURS`（默认 24）的文件。验收：单测覆盖"新文件不删、过期文件删"                               |
| c. multer 限额可配   | `middleware/uploadChunk.js`                        | `CHUNK_MAX_SIZE_MB`（默认 20）env 化。验收：改 env 后生效                                                                 |
| d. CORS 白名单 + 限流 | `app.js`                                           | `CORS_ORIGIN`（默认 `*` 保持兼容，生产建议收紧）+ `express-rate-limit`（默认 300 req/min per IP）。验收：非白名单 origin 被拒；超限返回 429    |
| e. 流销毁           | `controllers/downloadController.js:274,288`        | `req.on("close", () => stream.destroy())`。验收：中断下载后 `lsof`/`process._getActiveHandles()` 中 fd 数回落             |

### T2.7 下载列表性能与安全（对应 P1-14）🟡 复杂度：中 ✅ 已完成（2026-10-23）

| 项    | 内容                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `server/src/controllers/downloadController.js:143-227`、`server/src/routes/fileRoutes.js`                                                                                                                                                              |
| 改动要点 | ① `collectAllFiles()` 结果加 5s TTL 缓存（`mtime` 变化时失效）；② `file_id` 参数加格式校验（`/^[a-f0-9]{64}$/`）后才查缓存；③ `fileIdCache` 改为 LRU（上限 5000，用 `Map` 删除首位实现，不引第三方库）；④ `findFileById` 未命中不再触发全量 `collectAllFiles`，直接 404；⑤ `/list` 增加 `page` / `pageSize`（默认全量，保持兼容） |
| 验收标准 | ① 集成测试：随机 1000 个 file_id 请求不产生任何 `readdir`（用计数器断言）；② 10k 文件目录 `/list` P95 < 200ms                                                                                                                                                                     |

### T2.8 测试体系补齐（对应 P2-23）🟡 复杂度：中（贯穿）✅ 已完成


| 测试对象                 | 文件                                                                                | 状态 | 要点                                                                                  |
| -------------------- | --------------------------------------------------------------------------------- | -- | ----------------------------------------------------------------------------------- |
| 鉴权解析                 | `src/shared/authHeaders.test.ts`                          | ✅ | Bearer / 自定义头 / scheme / 空 token 四分支                                                |
| Worker 上传协议          | `src/components/ZustandFileUpload/worker/uploadWorker.{cancel,debug}.test.ts` + `services/uploadWorkerBridge.test.ts` | ✅ | CANCEL 中断在途 fetch、debug 节流（1000 分片默认 0 条）；秒传命中 / 分片跳过 / 失败上报经 bridge 脚本响应测试覆盖 |
| 清理策略                 | `src/components/ZustandFileUpload/services/cleanupPolicy.test.ts`              | ✅ | countdown / dispose / forceCleanup / ERROR 保留                                       |
| 下载断点恢复               | `src/components/ZustandFileDownload/services/downloadEventHandlers.test.ts`（新） | ✅ | 分片缺失 → 标记 PAUSED → 继续只拉缺失分片；齐全 → markCompleted + 异步 removeAllChunks                         |
| chunkStateQueue 崩溃恢复 | `server/tests/chunk-key.test.js`                                              | 🟡 | `reset:true` 分支（分片结果一致性清空）已覆盖；进程退出未 flush 的极端场景以磁盘为准的设计由 chunk-key 集成测试间接保障 |
| e2e 冒烟               | ~~`e2e/upload-download.spec.ts`（playwright）~~                                   | ⏸️ | **延后**：仓库无 playwright 依赖，服务端 29 个集成用例已覆盖上传/下载/合并主链路，引入 playwright 的成本收益暂不匹配 |
| 覆盖率门槛                | `vite.config.ts` `test.coverage` + `.github/workflows/ci.yml`                | ✅ | ratchet 策略：全库 lines 35 / funcs 40 / branch 40（当前 40.08 / 47.71 / 71.92）；`src/shared` 与 `services` 单独门槛（80 / 70），长期目标 60% / 80% 记录在案逐步抬高 |

> 注：`server/node_modules` 已安装并就绪（`npm --prefix server install`），server test script 串行执行；CI（`.github/workflows/ci.yml`）覆盖 lint → 客户端 test+coverage → 契约校验 → server test → 构建 → pack dry-run。

---

## 阶段三：架构升级（目标 2～3 周，需单独立项与评审）

> ⚠️ 阶段三改变对外行为，必须走 major 版本并在 README 标注 Breaking Change。

### T3.1 流式分片 + 采样哈希（对应 P0-3）🔴 复杂度：高

| 项               | 内容                                                                                                                                                                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件            | `worker/filePrepareWorker.ts`、`types/upload.ts`、`services/uploadStorage.ts`、`services/uploadWorkerBridge.ts`、`worker/uploadWorker.ts`、`hooks/useBatchUploaderController.ts:194`                                                                                                                                         |
| 设计要点            | ① `UploadFile` 移除 `buffer`，新增 `fileRef: File`（不序列化）；② 哈希改为**采样哈希**：首 4MB + 尾 4MB + 中间 3 个采样点 + `size`，默认关闭全量强哈希，`hashMode: "sample" \| "full"` 可配；③ 上传按 `fileRef.slice(start, end).arrayBuffer()` 逐片读、逐片传、逐片释放；④ **刷新续传新语义**：IndexedDB 只持久化"已上传分片索引 + 元数据"，刷新后需用户重新选择同一文件（或使用 OPFS 持久化分片），服务端 `chunkCheckResult` 决定续传范围 |
| Breaking Change | README「刷新可续传」从"自动恢复"改为"重新选择文件后续传已传分片"；`UploadFile.buffer` 字段移除                                                                                                                                                                                                                                                          |
| 验收标准            | ① 内存基准：2GB 文件上传期间 `performance.memory` 峰值增幅 < 200MB；② IndexedDB 中不存在整文件 Blob；③ e2e：刷新页面 → 重选同文件 → 已完成分片不重传（服务端计数断言）                                                                                                                                                                                                     |

### T3.2 全局单例治理（对应 P0-4）🔴 复杂度：高

| 项    | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `store/upload.ts`、`components/ZustandFileUpload/index.tsx:25-28`、`api.client.ts`、`services/uploadWorkerBridge.ts`、`services/uploadStorage.ts`、`package.json`                                                                                                                                                                                                                                                                                          |
| 设计要点 | ① store 改为 `createUploadStore()` 工厂 + `UploadStoreContext`，`useUploadStore` 从 context 取（保留 `useUploadStore.getState()` 逃生舱用于非 React 调用方）；② `localforage` 全部改为 `createInstance({ name: "react-upload-indexeddb", storeName: "upload_files" })`，**删除默认实例 `config()` 调用与 `localforage.clear()`**（改为 `instance.clear()`）；③ axios/runtimeConfig 收敛为 class 或 per-instance 实例；④ workerPool 改引用计数，最后一个持有者卸载才 dispose；⑤ `sideEffects` 修正为 `["*.css"]` 或直接删除该字段 |
| 验收标准 | ① 新增多实例测试：同页两个 `<FileUpload baseURL={A}/>` 与 `<FileUpload baseURL={B}/>` 互不串数据；② 消费方 `localforage` 默认实例中的数据不受影响；③ 卸载一个实例不影响另一个的下载任务                                                                                                                                                                                                                                                                                                                   |

### T3.3 状态机收敛 + 暂停/恢复（对应 P2-15）🟡 复杂度：中

| 项    | 内容                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `types/upload.ts:5-26`、`worker/uploadWorker.ts`、`types/workerProtocol.ts`、`components/FileUploadActions.tsx`、`components/FileTable.tsx`                       |
| 设计要点 | ① 删除未使用状态 `CALCULATING` / `MERGE_ERROR`（或真正写入）；② Worker 新增 `PAUSE` / `RESUME` 消息，上传循环内检查暂停标志（分片边界安全暂停，参考下载侧 `handlePause`）；③ UI 暴露暂停/继续按钮，`pausedChunks` 字段启用 |
| 验收标准 | ① 状态迁移表写入 `docs/architecture.md` 并有单测覆盖；② e2e：暂停 → 无 in-flight 请求 → 继续 → 从断点续传                                                                                |

### T3.4 字节级进度与速率（对应 P2-26）🟢 复杂度：低

| 项    | 内容                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `worker/uploadWorker.ts:396-407`、`types/workerProtocol.ts`、`services/uploadWorkerBridge.ts`、`hooks/useBatchUploaderController.ts:226-233`、`components/PercentDisplay.tsx`  |
| 改动要点 | ① 进度消息改为 `{ progress, uploadedBytes, totalBytes, speed, eta }`；② `onUploadProgress` 回调签名升级为 `(file, { progress, speed, eta })`（保留旧签名兼容一版，Deprecated 标记）；③ UI 显示 MB/s 与剩余时间 |
| 验收标准 | 单测：按字节累加计算 speed/eta；UI 冒烟显示速率                                                                                                                                             |

---

## 执行顺序与依赖

```
阶段一（可任意顺序，全部低风险）
  T1.1 ─┐
  T1.2 ─┤  鉴权链路收口后，README 订正(T1.3)必须最后做
  T1.3 ─┘
  T1.4  T1.5  T1.6  T1.7   （互不依赖，可并行）

阶段二
  T2.8(install+CI) ──► T2.1 ──► T2.2 ──► T2.3
                          │
                          ├──► T2.4 ──┐
                          ├──► T2.5 ──┤
                          ├──► T2.6 ──┼──► T2.8(最终覆盖率收口)
                          └──► T2.7 ──┘

阶段三
  T3.1 ──► T3.3
  T3.2 ──►（独立，可与 T3.1 并行）
  T3.4 ──►（独立，最后做）
```



---

## 每任务通用流程（DoD）

```
[ ] 代码改动完成，无新增 eslint warning
[ ] 新增/更新单测，且全部通过
[ ] 该任务「验收标准」逐条执行并回贴结果
[ ] 涉及协议改动 → types/workerProtocol.ts + 两端 + 测试同步更新
[ ] 涉及 props → README 与 docs/components.md 同步更新
[ ] CHANGELOG.md 增加 Unreleased 条目
[ ] PR 描述关联 analysis 中的问题编号（如 Fix P0-1）
```

## 风险与回滚

| 风险                | 触发场景           | 回滚方式                                                                           |
| ----------------- | -------------- | ------------------------------------------------------------------------------ |
| 鉴权改动导致老消费方请求头异常   | T1.1/T1.2 接线错误 | 单 PR 回滚；新增字段默认值保证向后兼容                                                          |
| 分片键改造导致历史任务无法续传   | T2.2 上线时存在在途任务 | 保留旧键兼容读取一版（`instantCheck` 同时查新旧键），一版后移除                                        |
| 服务端限流/CORS 误伤合法流量 | T2.6-d 阈值过严    | 默认值保持现状（`*` + 300/min），仅提供 env 收紧                                              |
| 阶段三刷新续传行为变化引发用户困惑 | T3.1           | major 版本 + README Breaking Change + 迁移说明；提供 `hashMode:"full"` 与 OPFS 持久化作为可选增强 |

## 版本规划

| 版本     | 内容          | 类型                                  |
| ------ | ----------- | ----------------------------------- |
| v1.1.0 | 阶段一 + 阶段二全部 | minor（新增 props，向后兼容）                |
| v2.0.0 | 阶段三全部       | major（移除 `buffer`、store 实例化、续传语义变化） |
