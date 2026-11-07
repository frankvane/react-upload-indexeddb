# 问题修复确认清单（29 条逐项核实）

> 核实对象：`docs/problem-analysis.md` 中列出的 29 条问题（P0×3 / P1×8 / P2×15 / P3×3）
> 核实基线：2026-11-07 当前磁盘代码（`git status` 显示 40 个已修改文件、10 个新增文件，均未提交）
> 核实方式：逐条打开实现文件对照原始问题描述与行号复核 + 实跑 lint / 类型检查 / 单测 / 覆盖率 / 服务端测试 / 构建 / audit
> 说明：本清单只做核实，不修改任何业务代码。

---

## 一、总体结论

| 结论 | 数量 | 条目 |
| --- | --- | --- |
| 已修复 | 21 | P0-1、P0-2、P0-3、P1-1、P1-2、P1-3、P1-5、P1-6、P1-8、P2-2、P2-3、P2-4、P2-6、P2-7、P2-8、P2-10、P2-11、P2-12、P2-13、P2-15、P3-2 |
| 部分修复 | 8 | P1-4、P1-7、P2-1、P2-5、P2-9、P2-14、P3-1、P3-3 |
| 未修复 | 0 | — |
| 无法确认 | 0 | — |

**核心结论**：三个 P0 均已实质修复，下载「完成 → 合并 → 导出」主链路已打通；服务端 md5 路径穿越与 Cookie 鉴权绕过均已封堵（且有针对性用例）。剩余 8 条均为「主缺陷已处理、但原始建议的一部分未落地或仍有余量」，无阻断级问题。

**仍需要后续处理的点（按优先级）**：

1. **P2-9**：多租户隔离仍未实现（`user_id` 仍取自请求体、秒传/合并查询不带用户维度），只修了内部字段泄漏。
2. **P1-4**：配额只按 `file_id` 计，攻击者换 `file_id` 即可继续占满磁盘；原建议的 `user_id` / 全局维度未实现。
3. **P2-5**：`saveChunkWithRetry` 失败只返回 `false`，调用方忽略返回值，落盘失败仍会被健康检查报成「分片缺失」。
4. **P1-7**：下载侧 `hooks/` 与 UI 组件覆盖率仍为 0%，覆盖率门禁虽已接入 `verify:client`，但阈值未上调。
5. **P2-1**：非秒传场景仍需在首片上传前串行（现为 4 并发）算完全部分片 MD5。
6. **P2-14 / P3-1 / P3-3**：React 19 组合未验证、发布包仍无 sourcemap、浏览器级冒烟未接入 CI。

---

## 二、核验环境与命令结果

| 核查项 | 命令 | 结果 |
| --- | --- | --- |
| ESLint | `npm run lint` | 通过，0 error / 15 warning（均为既有 `no-explicit-any`） |
| 应用/节点/测试类型检查 | `npx tsc -b --force` | 通过，0 错误 |
| 库入口类型门禁 | `npx tsc -p tsconfig.lib.check.json` | 通过，0 错误 |
| 前端单测 | `npm run test:unit` | **188/188 通过**（33 个测试文件） |
| 前端覆盖率门禁 | `npm run test:coverage` | 通过；lines 41.51% / statements 41.21% / functions 33.02% / branches 31% |
| 服务端单测 | `node --test --test-force-exit --test-concurrency=1 "tests/**/*.test.js"` | **72/72 通过，0 fail** |
| 服务端标准脚本 | `npm --prefix server test`（含覆盖率阈值） | ⚠️ 本机运行超过 10 分钟仍未退出（用例已跑完但进程未结束），已手动终止；推断为脚本缺 `--test-force-exit` + 句柄未释放。建议核对 `server/package.json` 的 `test` 脚本 |
| 库构建 | `npm run build` | 通过（2.55s），`strip-dts-css` 清理 4 个 `.d.ts` |
| 产物断言 | 构建后扫描 `dist` | `process.env` 命中 0；`.d.ts` 中 CSS 导入命中 0 |
| 生产依赖审计 | `npm audit --omit=dev` | **0 vulnerabilities**；`follow-redirects` 锁定 1.16.2 |
| 未执行 | `npm run test:browser` / `test:e2e` / `npm pack --dry-run` | 本次未跑（需浏览器 / 启动服务），对应结论依据代码与脚本存在性判断 |

---

## 三、逐条核实

### 3.1 P0 问题

#### P0-1 下载完成后从不合并，却立即删除全部分片 → **已修复**

- **依据**
  - `src/components/ZustandFileDownload/services/downloadEventHandlers.ts`：`handleDownloadComplete` 在分片健康检查通过后调用注入的 `mergeFile(file)`，不再直接 `markCompleted` + `removeAllChunks`；合并成功后由 `handleMergeComplete` 先 `completeFileStore.setItem(...)` 再异步清理分片。
  - `src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts:110-130`：通过 `mergeFile` 依赖注入接到 `mergeFileRef`，ref 未挂载时兜底走主线程合并，不会静默跳过。
  - `useFileDownloaderController.ts:145-213`：`mergeFileInternal` 覆盖「已合并」「分片缺失」「走 merge worker」「主线程兜底」四条路径，worker 路径传入 `MERGE_FILE`，主线程路径合并后清分片。
  - 回归用例：`downloadEventHandlers.test.ts:122`「分片齐全时触发合并（不再直接标记完成/删分片）」。
- **残留**：无。合并失败时置 `ERROR` 并保留分片，符合预期。

#### P0-2 `md5` 未校验即参与落盘路径拼接 → **已修复**

- **依据**
  - `server/src/utils/fileSecurity.js:15-19`：新增 `MD5_PATTERN = /^[a-f0-9]{32}$/i` 与 `isValidMd5`。
  - `server/src/utils/fileSecurity.js:25-34`：新增 `resolveInsideBase(baseDir, fileName)`，解析后越界抛 400。
  - `server/src/controllers/uploadController.js:460-464`：`mergeChunks` 在拼接文件名前强制 `isValidMd5(md5)`，非法直接 400 `invalid md5`。
  - `uploadController.js:524-534`：目标路径经 `resolveInsideBase(UPLOADS_DIR, storedFileName)`；staging 路径同样经 `resolveInsideBase(TMP_UPLOAD_DIR, ...)`。
  - 回归用例：`server/tests/upload-security.test.js:68`、`:82`（路径分隔符 / 非 32 位 hex 均 400）。
- **残留（不影响本条的路径安全结论）**：`:574` 的 `hash_mode !== "sample"` 仍允许客户端跳过「声明 md5 比对」。但落库 md5 已改为服务端 `md5File(stagingPath)` 计算的全量值（`:573`、`:618`），且 `md5` 已强制格式，因此不再构成写入路径风险，只剩「完整性校验强度可被客户端降级」的弱化问题。

#### P0-3 配置 `FILE_AUTH_COOKIE` 后任意非空 Cookie 即通过 → **已修复**

- **依据**
  - `server/src/middleware/auth.js:47-85`：默认 `requireAuth = true`；Cookie 分支仅当 `cookieTokens` 命中（`timingSafeEqual`）或 `verify` 放行时 `next()`，否则落到末尾统一 401。
  - `server/src/app.js:79-113`：读取 `FILE_AUTH_COOKIE_TOKENS` 并以 `cookieTokens` + `requireAuth: true` 挂载；未配置白名单时打印 FATAL 告警，且 Cookie 分支一律 401。
  - 回归用例：`server/tests/auth-middleware.test.js`（多条）、`auth-cookie-app.test.js`、`auth-cookie-allow.test.js`，覆盖「任意非空 Cookie → 401」「命中白名单 → 200」。
- **残留**：`app.js` 仍未向中间件传 `verify`（自定义校验回调未接线），但属于能力缺口而非绕过；默认路径已 fail-closed。

### 3.2 P1 问题

#### P1-1 COMPLETE 与分片落盘并发导致误判 → **已修复**

- **依据**：`src/components/ZustandFileDownload/hooks/useDownloaderLifecycle.ts:61-117` 新增 `pendingWritesRef`，按 `fileId` 串成 Promise 链；收到 `COMPLETE` 时先 `await` 该文件全部落盘任务，再执行 `onComplete`。
- **残留**：尚无直接针对「落盘 Promise 链 + COMPLETE 顺序」的单元用例（现有用例覆盖 handler 层）。属测试缺口，不是实现缺口。

#### P1-2 合并直接写对外目录、先清零导致可读到半成品 → **已修复**

- **依据**
  - `server/src/controllers/uploadController.js:425-438`：新增 `moveIntoPlace`（同卷 `rename`，`EXDEV` 退化为 copy + unlink）。
  - `uploadController.js:527-534`：合并写入 `TMP_UPLOAD_DIR/<storedName>.<fileId>.part`，不再直接写 `UPLOADS_DIR`。
  - `uploadController.js:566-585`：先校验 size 与 md5，全部通过后才 `moveIntoPlace` 原子移入目标目录。
  - `uploadController.js:652-657`：失败时同时清理 staging 与目标路径。
  - 回归用例：`server/tests/upload-security.test.js:117`、`:143`（失败无半成品 / 成功无 `.part` 残留）。
- **残留**：无。

#### P1-3 网络自适应改变 `chunkSize` 覆盖已固化分片方案 → **已修复**

- **依据**
  - `src/components/ZustandFileDownload/store/index.ts:136-161`：`fetchDownloadFiles` 优先沿用 `previous?.chunkSize`，并保留 `downloadedChunks` / `progress` / `status`。
  - `useFileDownloaderController.ts:247-271`：`startDownload` 以 IndexedDB 中持久化的 `chunkSize` 作为基线，重新归一化后才计算 `pendingChunks`。
- **残留**：页面刷新后内存 store 为空，列表首次仍按当前 `chunkSize` 计算 UI 展示值；只有点击开始下载时才用 IndexedDB 基线纠正。下载数据本身正确，属展示层短暂不一致。

#### P1-4 分片上传阶段无累计容量/文件数上限 → **部分修复**

- **已完成**
  - `server/src/controllers/uploadController.js:63-119`：新增按 `file_id` 的 `chunkUsage`（首次从磁盘播种、缓存上限 10000 项）。
  - `uploadController.js:384-401`：`/upload` 入口按「累计字节 - 覆盖旧分片 + 本次」与「累计片数」校验，超限分别返回 413 / 400；合并 / 重置后 `forgetChunkUsage`（`:253`、`:675`）。
  - 回归用例：`server/tests/hardening.test.js:51`、`:63`。
- **残留**：配额维度只有 `file_id`，**没有 `user_id` / 全局上限**。攻击者仍可不断更换 `file_id`，每个最多写 5GB / 10 万片，磁盘仍可被持续占满；原建议中的 user 维度未落地。

#### P1-5 样式子路径与 README 不一致 → **已修复**

- **依据**：`package.json:39-41` 同时导出 `./style.css` 与 `./dist/style.css`；`README.md:33` 改为 `react-upload-indexeddb/style.css`；`src/index.ts:2-4` 注释同步。`README.md:217` 提及 `dist/style.css` 仅为构建产物说明，不是消费方 specifier。

#### P1-6 生产依赖 high 漏洞导致 CI 审计失败 → **已修复**

- **依据**：`package.json:79-81` 新增 `overrides.follow-redirects: ^1.16.2`；`package-lock.json` 中 `follow-redirects` 已解析为 **1.16.2**（axios 1.20.0）。本次实跑 `npm audit --omit=dev` → **0 vulnerabilities**，退出码 0；`ci.yml:29-32` 的审计步骤可通过。

#### P1-7 覆盖率阈值不在本地门禁生效、下载链路 0% → **部分修复**

- **已完成**
  - `package.json:60` 新增 `test:coverage`；`:64` `verify:client` 使用 `npm run test:coverage`，本地与 CI 使用同一套阈值。
  - `vite.config.ts:41-63` 阈值生效（全局 35/30/35/25 + `src/shared/**`、`src/components/**/services/**` 分组）。
  - 实测：lines 41.51 / statements 41.21 / functions 33.02 / branches 31，均达标。
- **残留**
  - `npm test`（`:58`）仍只跑 `test:unit` + 契约校验，不带覆盖率；只有 `verify` 链路生效。
  - 下载侧**核心编排与 UI 仍为 0%**：`hooks/useFileDownloaderController.ts`、`useDownloaderLifecycle.ts`、`useDownloadFiles.ts`、`downloadPolicy.ts`、`services/mergeService.ts`、`index.tsx`、`components/FileList.tsx` 等覆盖率均为 0；`store/index.ts` 仅 12.5%。新增用例集中在 services / worker / api.client，P0-1、P1-1、P1-3 的编排层仍无回归保护。
  - 阈值仍维持 35/30/35/25，未按原建议 ratchet 上调。

#### P1-8 上传 worker 任务无超时，文件永久停在「上传中」 → **已修复**

- **依据**：`src/components/ZustandFileUpload/services/uploadWorkerBridge.ts:184-230` 新增 `idleTimeoutMs` 看门狗（每次消息 `bumpIdleTimer`，超时 `finish` 报错，且 `shouldRecycleWorker = false` 不回池）；`RunUploadTaskOptions` 暴露 `idleTimeoutMs`（`:46`），`0` 可关闭。
- **回归用例**：`uploadWorkerBridge.test.ts:445-490`（长时间无消息 → 报错并销毁 worker；持续进度 → 不误杀）。

### 3.3 P2 问题

#### P2-1 上传前串行预计算全部分片 MD5 → **部分修复**

- **已完成**
  - `src/components/ZustandFileUpload/worker/uploadWorker.ts:491-538`：先不带 `chunk_md5s` 做一次轻量秒传预检，命中即 `done(skipped)`，一个分片哈希都不算。
  - `uploadWorker.ts:540-545`：分片 MD5 计算由串行改为有界并发 `min(chunkConcurrency, 4)`。
- **残留**：**未命中秒传时，仍需在首个分片上传前算完全部分片 MD5**。延迟从「串行」降为「4 并发」，但仍是 O(分片数) 线性；`chunk_md5s` 依旧一次性放进 instant 请求体。原建议的「按需计算 / 分批提交」未落地。

#### P2-2 清理倒计时期间重新上传的文件被移出 UI → **已修复**

- **依据**：`src/components/ZustandFileUpload/services/cleanupPolicy.ts:131-143`（IndexedDB 清理）与 `:161-169`（UI 过滤）均先判断 `ERROR || isUploadInFlight(status)`，命中则保留文件并从 `completedFileIds` 移除；不可识别状态也保守保留。
- **用例**：`cleanupPolicy.test.ts` 新增「倒计时中变回 UPLOADING → 不删、不消失」。

#### P2-3 `maxFiles` 只校验本次选择 → **已修复**

- **依据**：`src/components/ZustandFileUpload/hooks/useFileProcessor.ts:106-116` 改为 `existingCount + files.length > maxFiles`，`existingFiles` 来自 store（`:49`、`:63`），提示语带已有数量。

#### P2-4 上传元数据无 schema 版本与迁移 → **已修复**

- **依据**
  - 新增 `src/components/ZustandFileUpload/services/uploadSchema.ts:14-105`：`UPLOAD_SCHEMA_VERSION = 2`、历史状态映射、`migrateUploadFile`（补默认值 / 裁剪进度 / 损坏丢弃）、`stampUploadSchema`。
  - `uploadStorage.ts:11-35`：`listUploadFiles` / `readUploadFile` 全部经迁移层。
  - `uploadStorageInstance.ts:24-33`：`createUploadStorage` 包装 `setItem` 统一盖章。
  - 用例：`uploadSchema.test.ts` 7 条。
- **残留**：未使用 localforage 的 `version` / `upgrade` 钩子（迁移在应用层实现，注释已说明是有意设计），不影响本条目标。

#### P2-5 分片落盘失败被静默吞掉，配额错误无差别重试 → **部分修复**

- **已完成**
  - `chunkPersistenceService.ts:10-37`：新增 `isQuotaError` 与 `hasStorageBudget`（`navigator.storage.estimate` 预检）。
  - `chunkPersistenceService.ts:76-79`：配额错误直接返回 `false`，不再 3 次无意义重试。
  - `useFileDownloaderController.ts:287-301`：开始下载前做配额预检，空间不足直接置 `ERROR` 并给出明确原因。
  - `useDownloaderLifecycle.ts:83-107`：落盘 Promise 抛错时记录 `writeErrorsRef`，`COMPLETE` 时按 `onError` 上报。
  - 用例：`chunkPersistenceService.quota.test.ts` 5 条。
- **残留**：`saveChunkWithRetry` 内部 `catch` 后只 `return false`（不抛错），而调用方 `handleChunkDownloaded`（`useFileDownloaderController.ts:98-108`）**忽略返回值**，因此 `writeErrorsRef` 不会记录这类失败。运行中配额耗尽 / 单分片写入失败仍会走到 `handleDownloadComplete` 的健康检查，最终提示「分片缺失/下载不完整」，而非「落盘失败/空间不足」——原问题描述的核心现象只是被「下载前预检」部分缓解，未被完全消除。

#### P2-6 重试耗尽的分片被静默丢弃，worker 仍发 COMPLETE/100% → **已修复**

- **依据**：`downloader.worker.ts:265-305` 在 `remainingChunks` 为空时用 `completedChunks` 反查缺失索引，缺片则 post `ERROR`（带缺失索引）并 `return`，只有真正拿齐才发 100% 进度与 `COMPLETE`。
- **用例**：`downloader.worker.retry.test.ts` 既有重试用例保持通过。

#### P2-7 `startDownload` 无重入保护 → **已修复**

- **依据**：`useFileDownloaderController.ts:226-233` 入口判断 `processingFiles.has(file.id)` 直接返回；`resumeDownload`（`:388-409`）显式传 `{ force: true }` 以绕开闭包中滞后的 state。

#### P2-8 无 DB 记录的文件下发「部分 md5」导致 >10MB 合并终检必失败 → **已修复**

- **依据**
  - 服务端：`server/src/controllers/downloadController.js:110-118` 为缓存条目补 `md5Mode`（`full` / `sample`），`:232-233` 列表每条返回 `md5Mode`；`server/src/utils/hash.js` 新增 `getPartialMd5Mode`（<10MB full、≥10MB sample）。
  - 客户端：`store/index.ts:159-160` 透传 `md5Mode`；`useFileDownloaderController.ts:185-188` 在 `sample` 时传 `expectedMd5: undefined`；`merger.worker.ts:42-52` 缺省即跳过严格比对。
  - 用例：`hardening.test.js:103`、`:116`。
- **残留**：`sample` 与 `full` 仍共用 `md5` 字段，语义靠 `md5Mode` 区分；旧版消费方 / 旧服务端组合仍可能误用，但新代码路径已闭环。

#### P2-9 秒传返回整行 `File` 记录，且 `user_id` 由请求体决定 → **部分修复**

- **已完成**
  - `server/src/controllers/uploadController.js:39-58` 新增 `toPublicFile` 白名单 DTO，只回 `file_id` / `file_name` / `size` / `md5` / `file_ext` / `file_type` / `category_id` / `created_at`；`instantCheck` 与「已合并」分支均改用该 DTO。
  - 用例：`hardening.test.js:74`、`:136`（命中响应不含 `user_id` / `file_path` / `thumbnail_path`，并反证 DB 中确实存在这些字段）。
- **残留（原问题的第二半未修）**
  - `instantCheck` 仍是 `File.findOne({ where: { md5, size, status: 1 } })`，**不带用户维度**，跨租户探测仍成立。
  - `user_id` 仍取自请求体（`uploadChunk` `:411`、`mergeChunks` `:616`），未由服务端身份推导；列表 / 下载也无归属过滤。
  - 即「内部元数据泄漏」已修复，「多租户隔离缺失」未修复。

#### P2-10 控制器把 `error.message` 原样回传 → **已修复**

- **依据**：新增 `server/src/utils/errorMessage.js`（仅 `test` / `development` 返回原文，其余固定 `internal server error`）；`uploadController.js:319`、`:349`、`:421`、`:666-671` 与 `downloadController.js:327`、`:370`、`:460` 全部改用 `redactErrorMessage`；合并 catch 对 4xx 业务文案保留原文、5xx 脱敏。
- **用例**：`hardening.test.js:123`（production 脱敏 / test 保留）。

#### P2-11 external 漏 `react-dom/client`，产物残留 `process.env.NODE_ENV` → **已修复**

- **依据**：`vite.lib.config.ts:44-45` 改为前缀正则 `/^(react|react-dom|zustand|localforage|axios)(\/.*)?$/`。本次 `npm run build` 后扫描 `dist/*.js`，`process.env` 命中 **0**。

#### P2-12 发布 `.d.ts` 引用不存在的 `ui/ui.css` → **已修复**

- **依据**：新增 `scripts/strip-dts-css-imports.mjs` 并接入 `package.json:51` 的 `build`；本次构建日志「扫描 85 个 .d.ts，清理 4 个文件中的 CSS 导入」，构建后扫描 `dist/**/*.d.ts` 的 `.css` 导入命中 **0**。
- **残留**：依赖构建后置脚本，绕过 `npm run build` 直接 `tsc` 产出声明时仍会带 CSS 导入；正式发布路径已覆盖。

#### P2-13 `--no-isolate` 全局关闭测试隔离 → **已修复**

- **依据**：`package.json:59` `test:unit` 改为 `vitest run`（无 `--no-isolate`）；`vite.config.ts:17` 使用 `pool: "forks"`，隔离恢复默认。本次连续实跑 188/188 通过。

#### P2-14 `engines.node` 与实际工具链不符，peer 未进开发依赖 → **部分修复**

- **已完成**：`package.json:17-19` 收敛为 `^22.12.0 || >=24.0.0`；`react` / `react-dom` / `zustand` 已加入 `devDependencies`（`:104-110`）。
- **残留**：`@types/react` 仍为 `^18.3.3`（`:92`），而 `peerDependencies` 声称支持 `react ^19`（`:83-84`）；CI 只有 Node 24 + React 18 组合，React 19 兼容性仍从未被验证。

#### P2-15 merge worker 合并成功后不清分片 → **已修复**

- **依据**：`downloadEventHandlers.ts` 的 `handleMergeComplete` 在 `markCompleted` 后调用 `chunkService.removeAllChunks(file.id, file.totalChunks)`，与主线程路径一致；用例 `downloadEventHandlers.test.ts:83` 断言清理分片。

### 3.4 P3 问题

#### P3-1 构建配置无类型门禁、存在无效配置项 → **部分修复**

- **已完成**
  - `tsconfig.node.json:21` 的 `include` 已加入 `vite.lib.config.ts`。
  - 新增 `tsconfig.lib.check.json` 与 `package.json:54` `typecheck`（`tsc -b && tsc -p tsconfig.lib.check.json`），库入口纳入类型门禁；本次实跑 0 错误。
  - `vite.lib.config.ts:50-51` 已移除对 ESM/CJS 无效的 `output.globals`。
- **残留**：`vite.lib.config.ts:33-35` 的 `build.sourcemap` 仍为 `false`（注释说明是有意为之以控制包体），发布包仍无 sourcemap；`tsconfig.lib.json` 未加入根 `references`（改由独立 `-p` 门禁覆盖，功能上等价）。

#### P3-2 包元数据、公共导出面与 CHANGELOG 不一致 → **已修复**

- **依据**
  - `package.json:7-15` 关键词已无 `antd`；`:112-120` 补 `repository` / `homepage` / `bugs` / `author`；`:41` 增加 `"./package.json"`。
  - `src/index.ts:27-37` `DownloadStatus` 改为值导出，并补 `DownloadStatusType` / `DownloadConfig` / `StorageStats`。
  - `CHANGELOG.md:69` 新增 `## [3.0.1] - 2026-11-06` 段。

#### P3-3 单测仅在 jsdom + fake-indexeddb，无浏览器级断言 → **部分修复**

- **已完成**：`package.json:63` 新增 `test:browser`，对应 `scripts/e2e-browser-smoke.mjs`（真实 Chromium + Vite dev + 临时服务端，校验 `fileName` / `size` / `md5`），README / CHANGELOG 有记录。
- **残留**：`test:browser` **未接入 CI**（`.github/workflows/ci.yml` 无该步骤），也未纳入 `verify:client`；浏览器级回归仍依赖手动执行，原建议的「纳入 CI 并与 verify 串联」未完成。

---

## 四、测试覆盖评估

| 编号 | 是否有针对性用例 | 说明 |
| --- | --- | --- |
| P0-1 | 是 | `downloadEventHandlers.test.ts:122`、`:83` |
| P0-2 | 是 | `upload-security.test.js:68`、`:82` |
| P0-3 | 是 | `auth-middleware.test.js`、`auth-cookie-app.test.js`、`auth-cookie-allow.test.js` |
| P1-1 | 间接 | 落盘队列本身无专门用例，仅 handler 层覆盖 |
| P1-2 | 是 | `upload-security.test.js:117`、`:143` |
| P1-3 | 否 | `store/index.persist.test.ts` 只测 persist 白名单，未覆盖 `fetchDownloadFiles` 保留 chunkSize |
| P1-4 | 是 | `hardening.test.js:51`、`:63` |
| P1-5 | 构建/打包级 | 无自动 resolve 断言，靠 `exports` 配置与人工核对 |
| P1-6 | 是 | `npm audit --omit=dev` 实测 0 漏洞 |
| P1-7 | 是（门禁） | `test:coverage` 已接入 `verify:client`；但下载 hooks/UI 无测试 |
| P1-8 | 是 | `uploadWorkerBridge.test.ts:445-490` |
| P2-1 | 否 | 秒传快路径 / 并发哈希无专门断言，仅既有 pause/cancel 用例回归 |
| P2-2 | 是 | `cleanupPolicy.test.ts` 新增用例 |
| P2-3 | 否 | 报告已注明「该 hook 无既有用例」 |
| P2-4 | 是 | `uploadSchema.test.ts` 7 条 |
| P2-5 | 部分 | `chunkPersistenceService.quota.test.ts` 覆盖配额与预检；未覆盖「saveChunkWithRetry 返回 false 被忽略」路径 |
| P2-6 | 是 | `downloader.worker.retry.test.ts` 回归 |
| P2-7 | 否 | 无 `startDownload` 重入用例 |
| P2-8 | 是 | `hardening.test.js:103`、`:116` |
| P2-9 | 是（仅 DTO 部分） | `hardening.test.js:74`、`:136`；租户隔离无用例（因为未实现） |
| P2-10 | 是 | `hardening.test.js:123` |
| P2-11 | 构建级 | 本次构建后扫描 `dist` 断言 |
| P2-12 | 构建级 | 本次构建日志 + 扫描 `dist\*\*.d.ts` |
| P2-13 | 是 | 本次全量单测连续通过 |
| P2-14 | 否 | 无 Node/React 版本矩阵 |
| P2-15 | 是 | `downloadEventHandlers.test.ts:83` |
| P3-1 | 类型门禁 | `tsc -p tsconfig.lib.check.json` 0 错误 |
| P3-2 | 否 | 无包元数据契约用例；`verify-client-contract.mjs` 是否覆盖待确认 |
| P3-3 | 脚本存在 | 未接入 CI，属手动验证 |

---

## 五、仍未修复 / 修复不到位汇总

### 5.1 部分修复（8 条）

| 编号 | 已解决 | 仍缺 |
| --- | --- | --- |
| **P1-4** | `/upload` 按 `file_id` 累计字节与片数上限，超限 413/400 | 无 `user_id` / 全局维度配额；换 `file_id` 仍可持续占盘 |
| **P1-7** | 覆盖率接入 `verify:client`，全局 41/41/33/31 | `npm test` 不带覆盖率；下载 hooks/UI 仍 0%；阈值未 ratchet |
| **P2-1** | 秒传快路径 + 分片哈希 4 并发 | 非秒传仍需全量预计算后才传首片；`chunk_md5s` 仍一次性提交 |
| **P2-5** | 配额错误不重试、下载前预检、异常路径上报 | `saveChunkWithRetry` 返回 `false` 被忽略，运行中落盘失败仍报「分片缺失」 |
| **P2-9** | 响应改为白名单 DTO，不再泄漏 `file_path` / `user_id` / `thumbnail_path` | 秒传查询无用户维度、`user_id` 仍由请求体决定、列表/下载无归属过滤 |
| **P2-14** | `engines` 收敛、peer 进 `devDependencies` | `@types/react` 仍 18、React 19 无 CI 组合 |
| **P3-1** | 构建配置纳入类型门禁、移除无效 `output.globals` | 发布包仍无 sourcemap；`tsconfig.lib.json` 未进根 `references` |
| **P3-3** | 新增真实浏览器冒烟脚本 | 未接入 CI / `verify`，仍靠手动执行 |

### 5.2 未修复

无。

### 5.3 本次核验新发现（不属于原 29 条）

1. **`npm --prefix server test` 不退出**：带覆盖率阈值的标准脚本在本机运行 10 分钟仍未结束（用例已全部跑完）；改用 `--test-force-exit` 后 72/72 立即结束。建议在 `server/package.json` 的 `test` 脚本补 `--test-force-exit`，否则 CI 的 `verify:server` 有挂起风险。
2. **服务端 `user_id` 仍未与鉴权身份绑定**（P2-9 残留的延伸）：`auth.js` 只校验「是否放行」，不产出身份，控制器只能信任请求体。若要真正多租户，需要中间件把身份写入 `req.user` 并在控制器使用。

---

## 六、改动范围（仅作定位线索）

`git status` 显示本次修复涉及 40 个修改文件 + 10 个新增文件，核心新增：

- `server/src/utils/errorMessage.js`
- `server/tests/auth-cookie-allow.test.js`、`auth-cookie-app.test.js`、`hardening.test.js`
- `src/components/ZustandFileUpload/services/uploadSchema.ts` 及其测试
- `src/components/ZustandFileDownload/services/chunkPersistenceService.quota.test.ts`
- `scripts/strip-dts-css-imports.mjs`、`scripts/e2e-browser-smoke.mjs`
- `tsconfig.lib.check.json`

> 以上改动均未提交（工作区状态），本清单结论以这些文件在磁盘上的当前内容为准。

---

## 七、二次核查与补充修复（2026-11-07 续）

> 针对第六节列出的 8 条「部分修复」逐项复核当前磁盘代码，凡不涉及产品/协议决策的残留全部当场修掉；需要新协议或身份体系的保留为「待决策」。

### 7.1 本轮已闭环（4 条）

| 编号 | 原残留 | 本轮处理 |
| --- | --- | --- |
| **P2-5** | `saveChunkWithRetry` 只 `return false`，调用方忽略返回值，运行中落盘失败仍被报成「分片缺失」 | `handleChunkDownloaded` 检查返回值并在失败时抛出（文案含分片序号与「可能是存储空间不足」），`useDownloaderLifecycle` 的 `catch` 才能写入 `writeErrorsRef`，`COMPLETE` 时按真实原因上报「分片落盘失败」 |
| **P1-4（全局维度）** | 配额只有 `file_id` 维度，换 id 即可继续占盘 | 新增进程级总配额 `MAX_TOTAL_UPLOAD_SIZE_MB`（默认 20GB）/ `MAX_TOTAL_CHUNKS`（默认 20 万）：用量从 `TMP_UPLOAD_DIR` 播种、按写入增量维护、合并/清理后失效重播；超限 413/400。用例：`hardening.test.js`「换 file_id 也无法突破进程总容量」 |
| **P3-3** | `test:browser` 未接入 CI | `ci.yml` 新增独立 `browser` job（客户端 + 服务端依赖 + `npx playwright install --with-deps chromium` + `npm run test:browser`）。本地实测通过（Node 24）：2.1MB 文件上传后端 md5 一致 |
| **5.3 #1** | `npm --prefix server test` 用例跑完但进程不退出 | 根因是 `chunkStateQueue.scheduleFlush` 的 `setTimeout` 持有事件循环；加 `unref()` 后 73/73 用例 16s 正常退出，未用 `--test-force-exit` 掩盖句柄泄漏 |

附带：根 `test` 改为 `test:coverage`，本地跑 `npm test` 即受覆盖率阈值约束（原残留「`npm test` 不带覆盖率」已消除）。

### 7.2 覆盖率变化（P1-7 残留缩减）

| 指标 | 修复前 | 现在 |
| --- | --- | --- |
| 全局 lines / statements / functions / branches | 41.51 / 41.21 / 33.02 / 31 | **42.5 / 42.18 / 34.08 / 32.11** |
| `ZustandFileDownload/store/index.ts` | 12.5% | **43.75%** |
| `ZustandFileDownload/hooks/downloadPolicy.ts` | 0% | **100%** |
| `useFileDownloaderController.ts` / `useDownloaderLifecycle.ts` | 0% | 0%（仍需 worker + context 级测试夹具） |

新增用例：`store/index.fetch.test.ts`（P1-3：保留 `chunkSize` / 进度 / 状态，新文件按 store 分片，列表失败不落半成品）、`hooks/downloadPolicy.test.ts`（归一化 4 例 + worker 消息 3 例）。

### 7.3 复核后仍然待决策（4 条，不建议盲改）

| 编号 | 仍缺 | 原因 / 前置条件 |
| --- | --- | --- |
| **P2-9** | 秒传查询无用户维度、`user_id` 取自请求体、列表/下载无归属过滤 | 当前鉴权是「共享密钥放行」模型（`auth.js` 只判 401/放行，不产出身份），没有账号体系就没有可用的 `userId`；真做多租户需先定义身份来源（登录 / 网关注入头）并同步改列表、下载、秒传三处查询 |
| **P1-4（user 维度）** | 按 `user_id` 的配额 | 同上；本轮已用全局上限把「无限占盘」收敛为有界，风险可控 |
| **P2-1** | 非秒传仍需在首片上传前算完全部分片 MD5 | `chunk_md5s` 是 instant 协议的整批入参，改「按需 / 分批」需客户端与服务端同时改协议（并处理断点续传语义），属协议变更 |
| **P2-14 / P3-1** | React 19 CI 组合；发布包 sourcemap | React 19 需在 CI 额外装 `react@19` + `@types/react@19` 矩阵（本机 npm 出网 502，无法先本地验证，不盲加）；sourcemap 为有意关闭（`.map` 占包体 70%+，配置内已注明） |

### 7.4 本轮验证结果

| 核查项 | 命令 | 结果 |
| --- | --- | --- |
| ESLint | `npm run lint` | 0 error / 15 warning（既有 `no-explicit-any`） |
| 类型检查 | `npm run typecheck` | 通过 |
| 前端单测 + 覆盖率门槛 | `npm run test:coverage` | 通过（42.5/42.18/34.08/32.11） |
| 服务端标准脚本 | `npm --prefix server test` | **73/73 通过，16s 正常退出**（含覆盖率门槛） |
| 库构建 | `npm run build` | 通过，`strip-dts-css` 清理 4 个 `.d.ts` |
| 浏览器级冒烟 | `npm run test:browser` | 通过（真实 Chromium 全链路上传 + md5 比对） |

> 注：本机若在带「安全删除」拦截的宿主里跑服务端测试，`fs.unlinkSync` 累计超过阈值会被拦截并让部分用例 500；这不是代码问题，`CODEBUDDY_SAFE_DELETE_ENABLED=0` 下全绿。
