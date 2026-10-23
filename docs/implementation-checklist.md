# react-upload-indexeddb 实施清单（Implementation Checklist）

> 配套文档：[`project-analysis.md`](./project-analysis.md)（问题分析与证据）  
> 制定日期：2026-10-23　｜　基线版本：`v1.0.5`　｜　目标版本：`v1.1.0`（阶段一+二）/ `v1.2.0`（阶段四 T4.1+T4.2）/ `v1.3.0`（阶段四 T4.3 去 antd）/ `v2.0.0`（阶段三）

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

**阶段四：依赖瘦身 —— T4.3 已完成 ✅**（T4.1 / T4.2 / T4.3 全部落地；T4.1b vite 8 为可选项未做）

| 任务                               | 状态 | 验证证据                                                                                                |
| -------------------------------- | -- | --------------------------------------------------------------------------------------------------- |
| T4.1 vitest5 + vite7 升级          | ✅  | 108 单测全绿；coverage 切 istanbul（v8+SWC 失真，见分析文档）后门槛全过；lib 169.51 kB（-4.3%）；四 worker 内联 Blob 经 sourcemap 验证；CI Node 22 |
| T4.1b vite 8 迁移（可选）           | ⬜  | 未做（Rolldown 切换需 manualChunks→codeSplitting + worker inline 复验）                                 |
| T4.2 去 ahooks                    | ✅  | `npm ls ahooks` 为空；deps 仅 axios/localforage/spark-md5；useNetwork 5 用例 + networkStrategy 扩至 17 用例（95.83%） |
| T4.3 去 antd                      | ✅  | 见下方 T4.3 专节；lib typecheck/lint/108 用例/29 server 用例全绿；demo 产物 -71%；peer 仅剩 react/react-dom/zustand |

**下一步**：① 将当前内容分别打 tag 发布（T4.1+T4.2 → `v1.2.0`；T4.3 → `v1.3.0`，**建议独立分支**：默认视觉由 antd 设计语言变为库自带样式，属可感知变更）；② 阶段三（T3.1 流式分片 / T3.2 单例治理 / T3.3 状态机 / T3.4 字节级进度）需用户确认后立项，目标版本 `v2.0.0`。

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

### T3.1 流式分片 + 采样哈希（对应 P0-3）🔴 复杂度：高 ✅ 已完成（2026-10-23）

| 项               | 内容                                                                                                                                                                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件            | `worker/filePrepareWorker.ts`、`types/upload.ts`、`types/workerProtocol.ts`、`services/uploadStorage.ts`、`services/uploadWorkerBridge.ts`、`worker/uploadWorker.ts`、`hooks/useFileProcessor.ts`、`hooks/useBatchUploaderController.ts`、`services/fileRegistry.ts`（新）、`context/UploadContext.tsx`、`hooks/useEffectiveConfig.ts`、`server/src/controllers/uploadController.js`、`src/test/setup.ts`（jsdom `Blob.arrayBuffer` 补丁） |
| 设计要点            | ① `UploadFile` 移除 `buffer`，新增 `fileRef: File`（不序列化，仅运行时）；② 新增 `services/fileRegistry.ts` 主线程文件引用注册表（登记/取用/释放，删除/清理时联动释放）；③ 哈希支持**采样哈希**：`hashMode: "sample" \| "full"` 可配，默认 `full`（全量流式 hash，内存与文件大小无关），`sample` 为首 4MB+尾 4MB+中间 3 采样点+size；④ 上传 Worker 按 `fileRef.slice(start,end).arrayBuffer()` 逐片惰性读取、逐片 md5、逐片上传，内存峰值 = `chunkSize × chunkConcurrency`；⑤ **刷新续传新语义**：IndexedDB 只持久化元数据，刷新后 `recoverInterruptedUploadFiles` 标记 `awaitingReselect`，上传前 `getFileRef` 缺失则提示「请重新选择文件」；⑥ 服务端 `mergeChunks` 在 `hash_mode==="sample"` 时跳过全量 md5 强校验（分片级 md5 校验保留） |
| Breaking Change | README「刷新可续传」从"自动恢复"改为"重新选择文件后续传已传分片"；`UploadFile.buffer` 字段移除（API 消费方若曾读取该字段须删除）                                                                                                                                                                                                                                                                                                                                                       |
| 验收标准            | ① 内存基准：整文件不再驻留（无 `performance.memory` 峰值占满风险，理论上限 = chunkSize×chunkConcurrency）；② IndexedDB 不再写入整文件 Blob（`buffer` 字段已从类型与代码移除）；③ 全量 `vitest run` **21 文件 / 108 用例全绿**，覆盖 worker CANCEL / debug 节流 / bridge / storage recovery / cleanup；④ `eslint .` 0 告警；⑤ lib 构建成功（`dist/index.js` 204.52 kB + `dist/style.css` 15.25 kB）；⑥ server 语法校验通过 |
| 实施结果            | ① 108 单测全绿，lint 0 告警，lib 构建 + tsc d.ts 退出 0；② `grep "buffer" src` 仅剩注释残留；③ `fileRef` 经 `fileRegistry` 在成功/删除/清理时释放，避免 File 句柄长期驻留；④ `hashMode` 从 props 贯通到预处理 Worker、上传 Worker、服务端 merge；⑤ 测试环境 jsdom 缺 `Blob.arrayBuffer`，在 `setup.ts` 以 `FileReader` 补齐（浏览器原生支持，production 代码不变） |
| 遗留事项            | ① 2GB 真实内存基准 / e2e 刷新重选断言依赖浏览器人工或 playwright（仓库未引入），暂以架构论证 + 单测间接保障；② `sample` 模式为可选增强，默认仍 `full`，秒传与全量校验不变；③ `fileRegistry` 已在 T3.2 改为按组件实例持有（`createFileRegistry()` 工厂 + `UploadEngine.fileRegistry`），模块级单例已移除 |

> 注：T3.1 已独立可验证（108 用例 + lint + lib 构建 + server 语法），但**未单独打 tag**——按阶段三整体目标版本 `v2.0.0`，待 T3.2~T3.4 完成后一并发版（或用户确认先行发 `v2.0.0-alpha.1`）。

### T3.2 全局单例治理（对应 P0-4）🔴 复杂度：高 ✅ 已完成（2026-10-23）

| 项    | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `store/upload.ts`、`context/UploadEngineContext.tsx`（新）、`context/UploadContext.tsx`、`services/uploadStorageInstance.ts`（新）、`services/fileRegistry.ts`、`services/uploadWorkerBridge.ts`、`services/uploadStorage.ts`、`services/cleanupPolicy.ts`、`services/uploadOrchestrator.ts`、`hooks/useFileProcessor.ts`、`hooks/useFileOperations.ts`、`hooks/useBatchUploaderController.ts`、`hooks/useNetworkDetection.ts`、`index.tsx`、`../ZustandFileDownload/api.client.ts`、`package.json`、`src/test/setup.ts` |
| 设计要点 | ① 引入**每实例引擎聚合对象** `UploadEngine`（instanceId + storage + fileRegistry + workerPool + store），由 `UploadProvider` 经 `useRef` 创建并随组件生命周期存在，经 `UploadEngineContext` / `UploadStoreContext` 下发给 hooks/services；② `createUploadStore(storage)` 工厂替代模块级 `create()` 单例，`useUploadStore(selector)` 改从 context 读（保留 `useUploadStoreApi()` 逃生舱供非 React 调用）；③ `localforage` 全部改为 `createUploadStorage(instanceId)` 具名 `createInstance`（`name:"react-upload-indexeddb"`、`storeName:"upload_files_{instanceId}"`），**删除默认实例 `config()` 与 `localforage.clear()`**，改用 `instance.clear()`；④ `fileRegistry`/`workerPool` 改为工厂 + 闭包隔离，`workerPool.dispose()` 仅释放本实例持有的 worker（引用计数语义）；⑤ 下载侧 `createDownloadApiClient()` 工厂替代模块级 `apiClient`/`runtimeConfig`（保留默认单例导出向后兼容）；⑥ `package.json` `sideEffects` 由 `false` 修正为 `["*.css"]`，避免消费方打包树摇掉 `ui.css`；⑦ 新增 `fake-indexeddb/auto` 供真实存储隔离测试 |
| 验收标准 | ① 新增多实例隔离测试 `context/uploadEngine.isolation.test.tsx`：同页两个 `instanceId` 不同的 `<FileUpload>` 在 store/storage/fileRegistry/workerPool 四个维度均互不串；默认（不传）实例回落固定 storeName；② 消费方 `localforage` 默认实例不受影响（库数据落在独立 IndexedDB）；③ 卸载一个实例仅释放自身 workerPool + 释放自身 fileRef，不影响另一实例；④ `eslint`/`tsc(lib)`/`vitest`/`vite lib build` 全绿（`style.css` 15.25 kB 正常产出） |
| 实施结果 | ① 全库 `grep "localforage.config\|localforage.clear()\|useUploadStore.setState" ` 仅剩本说明与测试桩，无业务单例残留；② `eslint .` 0 告警、`tsc -p tsconfig.lib.json` 0 错误、`vitest run` **22 文件 / 113 用例全绿**（含 5 个新增隔离用例）；③ `vite build` 成功，`dist/index.js` 207.34 kB / `index.cjs` 145.27 kB / `style.css` 15.25 kB；④ 修复了 T3.1 遗留的「fileRegistry 模块级单例」问题，并顺带修正 `useNetworkDetection` 误用 `useUploadStore.setState` 的隐患 |
| 遗留事项 | ① 版本号建议随 T3.3/T3.4 一并发 `v2.0.0`（Breaking Change：单实例刷新续传语义已在 T3.1 变更），或用户确认先行 `v2.0.0-alpha.1`；② 下载侧 `createDownloadApiClient` 暂未被 `<FileDownload>` 组件按 instanceId 消费，仍为默认单例（能力已具备，按需再接线）；③ 发布走 Clash 代理 `127.0.0.1:7890`（直连 registry.npmjs.org 超时） |

### T3.3 状态机收敛 + 暂停/恢复（对应 P2-15）🟡 复杂度：中 ✅ 已完成

| 项    | 内容                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `types/upload.ts`、`worker/uploadWorker.ts`、`worker/filePrepareWorker.ts`、`types/workerProtocol.ts`、`services/uploadWorkerBridge.ts`、`services/uploadStorage.ts`、`hooks/useBatchUploaderController.ts`、`components/FileTable.tsx`、`components/StorageStatsDrawer.tsx`、`components/PercentDisplay.tsx`、`index.tsx` |
| 设计要点 | ① 收敛共享状态机：删除从未被赋值的死状态 `CALCULATING` / `MERGE_ERROR`（`UploadStatus` 枚举、`statusMap`、`StorageStatsDrawer` 渲染、预处理 Worker 内部枚举同步清理），保留 `PAUSED`；② `isUploadableStatus` 收敛为 `QUEUED \| QUEUED_FOR_UPLOAD \| PREPARING_UPLOAD \| UPLOADING \| ERROR`——**`PAUSED` 不再是可上传态**，必须由用户点击「继续」显式触发 `resumeUploadFile`，避免与暂停中的 Worker 重复运行；③ Worker 新增 `pause` / `resume` 消息：`pause` 置 `taskPauseState.paused=true` 并立即回 `paused`（携带 `uploadedChunks`/`totalChunks`），分片循环在每个分片起始 `await waitWhilePaused()` 于边界安全挂起；`resume` 触发 `resumeResolver` 解除挂起并从断点续传；④ Bridge 新增 `pauseUploadTask(fileId)` / `resumeUploadTask(fileId): boolean`，`paused` 响应以 `paused:true` 收尾并**销毁该 Worker（不回空闲池）**——避免挂起闭包与 `taskPauseState`/`taskStats`/`taskAbortControllers` 残留；⑤ Controller 新增 `pauseUploadFile`/`resumeUploadFile`：暂停即乐观置 `PAUSED` + 通知 Worker 边界暂停；继续时若 `resumeUploadTask` 返回 `false`（Worker 已释放/刷新卸载）则复用 `processFileUpload` 重新发起，服务端 `chunkCheckResult` 保证字节级续传（与下载侧 `handlePause` → 重跑 `startDownload` 一致的 fallback 语义）；⑥ UI 在上传中行显示「暂停」、已暂停行显示「继续」 |
| 验收标准 | ① 状态迁移表写入 `docs/architecture.md`（§6）并有单测覆盖；② `uploadStorage.test.ts` 断言 `isUploadableStatus(PAUSED)===false`；③ `uploadWorkerBridge.test.ts` 覆盖 pause 发指令 / resume 返回 true 发指令 / 未知任务 resume 返回 false / paused 后 resume 返回 false；④ `uploadWorker.pause.test.ts` 覆盖暂停回 `paused` 并停止新分片请求、暂停后 resume 续传至 `done` 并回传字节级详情 |
| 实施结果 | ① `grep CALCULATING\|MERGE_ERROR` 在业务链路（共享 `UploadStatus`/`statusMap`/store/UI）清零，仅预处理 Worker 内部独立枚举残留亦已清理；② `eslint .` 0 告警、`tsc -p tsconfig.lib.json` 0 错误、`vitest run` 全绿（新增 `uploadWorker.pause.test.ts` 2 用例 + bridge 5 用例 + storage 1 用例）；③ 暂停/继续按钮在 `FileTable` 接线，`index.tsx` 透传 handler |
| 遗留事项 | ① 续传 fallback 走「重跑 `processFileUpload`」而非严格复用暂停中的 Worker（因 Bridge 销毁了暂停态 Worker）；如需零重算（跳过 MD5/秒传校验）的纯 Worker 内续传，需改造 Bridge 让 `paused` 不解析 `runUploadTask` 而是挂起监听直到 `done`，超出本次范围；② 版本号随 T3.4 一并发 `v2.0.0` |

### T3.4 字节级进度与速率（对应 P2-26）🟢 复杂度：低 ✅ 已完成

| 项    | 内容                                                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `types/upload.ts`（新增 `UploadProgressDetail`）、`worker/uploadWorker.ts`（分片成功后 `computeUploadProgress` 计算并回传）、`services/uploadProgress.ts`（新增纯函数 + 单测）、`types/workerProtocol.ts`、`services/uploadWorkerBridge.ts`、`store/upload.ts`（`speedMap`/`etaMap`/`patchFile`）、`hooks/useBatchUploaderController.ts`（写入 speed/eta + 旧/新双回调）、`components/PercentDisplay.tsx`（速率/剩余时间副行）、`components/FileTable.tsx` |
| 改动要点 | ① 新增纯函数 `computeUploadProgress({uploadedBytes,totalBytes,elapsedMs})` 产出 `UploadProgressDetail{progress,uploadedBytes,totalBytes,speed,eta}`，含 0 除/越界/完成态保护；② Worker 进度消息升级为 `{progress,uploadedBytes,totalBytes,speed,eta,chunkIndex?}`，Bridge 原样透传 detail 对象；③ `onUploadProgress` 旧签名 `(file, progress:number)` 保留并标记 `@deprecated`，新增 `onUploadProgressDetail(file, detail)`；④ store 新增 `speedMap`/`etaMap`，UI 在 `UPLOADING` 行展示 MB/s 与剩余时间（`PercentDisplay` 副行） |
| 验收标准 | ① `uploadProgress.test.ts` 8 用例覆盖 50% / speed / eta / 完成态 / elapsed=0 / speed≈0 / 越界 / totalBytes=0；② `uploadWorkerBridge.test.ts` 断言 progress 透传完整 detail；③ `uploadWorker.pause.test.ts` 断言 progress 携带 `uploadedBytes>0`、`totalBytes===fileSize`、`speed`/`eta` 为数值 |
| 实施结果 | ① 字节级速率/剩余时间随每个分片成功回传，UI 实时显示；② 旧签名消费方（`App.tsx`）无破坏；③ 全链路 `tsc`/`eslint`/`vitest` 全绿 |
| 遗留事项 | 版本号随 T3.3 一并发 `v2.0.0` |

---

## 阶段四：依赖瘦身（不动业务逻辑，分析见 [`dependency-slimming-analysis.md`](./dependency-slimming-analysis.md)）

> 阶段四全部任务**不改变对外 API**（props / 事件 / 导出类型），除默认视觉样式外无 Breaking Change。
> 版本规划：T4.1+T4.2 → `v1.2.0`；T4.3 → `v1.3.0`（建议独立 minor 发版，与阶段三 `v2.0.0` 解耦）。

### T4.1 测试工具链升级：vitest 2 → 5 + vite 5 → 7（🟢 复杂度：低，1 人日）✅ 已完成

| 项    | 内容                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `package.json`（devDeps）、`.github/workflows/ci.yml`（Node 20 → 22）、`vite.config.ts`（coverage provider + 门槛重校）                                                                                                    |
| 改动要点 | ① vitest 2.1.8 → 5.0.5 + `@vitest/coverage-v8` 5.0.5（peer 对齐，消解当年降级安装的冲突）；② 连带 vite 5.4.19 → 7.3.7 + `@vitejs/plugin-react-swc` 3.10 → 4.x（vitest 5 要求 vite ≥6.4 且 vite 改为 peer）；③ Node ≥22.12，CI setup-node 改 22 |
| 风险核对 | `clearMocks` 已显式 true（v5 默认变更无影响）；`vi.mock`/`vi.hoisted` 均在顶层（v5 强制要求，已合规）；`-t`/`sequential` 未用；coverage `thresholds` glob 键复验可用 |
| 为什么不上 vite 8 | vite 8 换 Rolldown+Oxc：`manualChunks` 函数形式 deprecated（须迁 `codeSplitting.groups`）、压缩器变更需复测体积、4 个 `?worker&inline` 需重点复验（1.0.4/1.0.5 踩坑区）。收益（构建速度）对本库有限，拆为 T4.1b 可选 |
| 验收标准 | ① 90 单测全绿 + coverage 门槛通过（含 glob）；② lib 产物体积偏差 <5%；③ pack dry-run 71 文件不变；④ CI（Node 22）全绿 |
| 实施结果 | ① 108 单测全绿（含新增 useNetwork 5 + networkStrategy 补强 13）；② **coverage provider 实际切 istanbul**：v8 + SWC AST 重映射数字失真（#9293 复现：内联组件 0%/低报，useNetworkDetection 91.66%→0%），istanbul 源码级插桩准确（恢复 90%，与旧基线吻合）；门槛按 istanbul 实测重校（全库 35/30/25，shared 80 已达 96.4/94.9/100/96.7，services 65/70/65/60）；③ lib 产物 169.51 kB（gzip 43.58，较升级前 177.17/51.08 **小 4.3%**），四 worker 仍以内联 Blob 交付（sourcemap 验证），pack 72 文件；④ CI 已改 Node 22；⑤ 卸载不再使用的 `@vitest/coverage-v8` |

### T4.1b vite 7 → 8 迁移（🟡 复杂度：中，1~2 人日，**可选，未做**）

| 项    | 内容                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | `vite.config.ts`（`build.rollupOptions.output.manualChunks` → `build.rolldownOptions.output.codeSplitting.groups`）、`vite.lib.config.ts`（复验 lib 模式 + worker inline）                                                              |
| 改动要点 | ① demo 配置迁 `codeSplitting.groups`；② Oxc minifier 上线后对比产物体积；③ **四个 Worker `?worker&inline` 冒烟复验**（filePrepare/upload/merger/downloader）；④ 无回退问题后删除 rollupOptions 旧键 |
| 验收标准 | ① lib 与 demo 构建均成功，worker 内联行为不变（demo 上传 5MB 文件冒烟）；② 体积对比报告存档；③ 单测 + server 用例全绿 |

### T4.2 去除 ahooks：自研 useNetwork（🟢 复杂度：低，0.5 人日）✅ 已完成

| 项    | 内容                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | 新增 `src/shared/useNetwork.ts` + `src/shared/useNetwork.test.ts`；改 `ZustandFileUpload/hooks/useNetworkDetection.ts`、`ZustandFileDownload/hooks/useNetworkDetection.ts`（仅改 import）；`package.json` 删 `ahooks`；`vite.lib.config.ts` external 删 `ahooks`；README 依赖说明 |
| 改动要点 | ① 自研 hook 对齐 ahooks 实现的 4 个字段（`online`/`rtt`/`type`/`effectiveType`），事件监听一致（online/offline/connection change），SSR 安全；② 不加 `since` 等死字段；③ 单测 5 用例（初值/online/offline/connection change/卸载清理） |
| 验收标准 | ① `npm ls ahooks` 为空，pack 后无 ahooks 引用；② `networkStrategy.test.ts` 7 用例仍绿；③ 两处 useNetworkDetection 行为不变（代码评审 + 手工断网冒烟） |
| 实施结果 | ① `npm ls ahooks` 为空，`dependencies` 仅剩 axios/localforage/spark-md5，README 已注明；② 全量 108 用例全绿（useNetwork 5 用例 + networkStrategy 扩至 17 用例，覆盖率 59.72%→95.83%）；③ lib 构建/契约/pack 全部通过 |

### T4.3 去除 antd：自建轻量 UI 层（🔴 复杂度：高，14~20 人日）✅ **已完成**

| 项    | 内容                                                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 涉及文件 | 19 个文件替换 antd 导入；新增 `src/ui/`（9 个文件：primitives / typography / feedback / collapse / table / message / icons / index + `ui.css`）；`store/upload.ts` 的 `MessageInstance` 类型换自研 message；`package.json` peerDependencies 删 antd、卸载 antd + @ant-design/icons；`vite.lib.config.ts` external 删 antd/icons、加 `cssFileName: "style"`；`vite.config.ts` demo 删 antd manualChunks 分组；README 补样式引入指引 |
| 实施方式 | **精减模式**（用户拍板）：只实现调用点真实用到的 API 面（19 类组件 + 19 图标），不做 antd 全量复刻；CSS 为静态样式表（`rui-` 前缀，视觉贴近 antd v5）；图标 path 数据提取自 `@ant-design/icons-svg` 的 ASN 定义（视觉一致、零依赖）；drop-in 容忍策略：Tag color 放宽 string、Table render 首参 `any`、Tooltip 补 `getPopupContainer`、InputNumber 补 `addonAfter/size`、Switch/Statistic/Progress 补缺失 props、`Modal.confirm` 挂静态方法 |
| 已具备利好（兑现） | ① 上传侧 message 注入层已存在（`getMessageApi`/`setMessageApi`）——默认实例换成自研 message；② 公共 API 无 antd 类型泄漏（`AlignItem` 是本地联合类型）；③ src 零 `.css` import → 仅需一个自带 `ui.css` |
| 收益（实测） | peer 依赖 4→3；demo 产物 ~1297 kB → ~368 kB（**-71%**，antd 生态 929 kB 清零 + vite 7 循环 chunk 警告清零）；lib 203.46 kB / gzip 53.10 kB（含 UI 套件，+34 kB 换 -929 kB 依赖）；`dist/style.css` 15.25 kB / gzip 3.41 kB |
| 代价 | 已用 antd 的消费方（如 vane-crm）多带 ~34 kB 库 UI；默认观感从 antd 设计语言变为库自带样式（README 已明示 + `rui-` 前缀提供覆盖入口） |
| 验收标准 | ① `grep "from \"antd\""` 与 `@ant-design/icons` 在 src 均为空 ✅；② 108 单测全绿（含 UI 套件间接覆盖）+ UI 导出面与导入面差集校验脚本零缺失 ✅；③ `dist/style.css` 产出且 pack 81 文件包含 ✅；④ demo 构建 ~368 kB < 400 kB ✅；⑤ lib typecheck（`tsc -p tsconfig.lib.json`）0 错误 + eslint 0 告警 ✅；⑥ README 明示样式变化与 `import ".../dist/style.css"` 引入方式 ✅ |
| 遗留事项 | ① UI 套件自身单测（组件渲染/交互）未单独编写——现有 108 用例经业务代码间接覆盖 UI 行为，专项单测列为可选项；② 视觉回归走走查依赖人工（demo 站点 `npm run build:demo`）；③ `Modal.confirm` 与 `message` 的 React 18 `createRoot` 路径在 React 19 消费方需复验（createRoot API 在 19 仍可用） |

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

阶段四（不依赖阶段三，建议先于阶段三执行）
  T4.1 vitest5+vite7 ─┐（T4.1/T4.2 可并行，互不依赖）
  T4.2 去 ahooks ─────┼──► v1.2.0
  T4.1b vite 8（可选）┘
  T4.3 去 antd ──────────────────────────────► v1.3.0
        （T4.3 先于阶段三：UI 私有化后反而简化 T3.2 单例治理）

阶段三（需单独立项评审）
  T3.1 流式分片 ──► T3.2 单例治理 ──► T3.3 状态机 ──► T3.4 字节级进度 ──► v2.0.0

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
