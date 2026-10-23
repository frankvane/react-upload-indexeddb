# react-upload-indexeddb 项目全面分析报告

> 分析日期：2026-10-23　｜　版本：`v1.0.5`　｜　分析范围：`src/`（客户端库 + Demo）、`server/`（Express + SQLite 参考实现）、`scripts/`、`docs/`、构建与发布配置

---

## 0. 结论速览

| 维度 | 评级 | 一句话结论 |
| --- | --- | --- |
| 功能完整性 | ⚠️ 中 | 上传链路闭环可用；**下载链路在鉴权场景下不可用**，暂停能力缺失 |
| 大文件能力 | ❌ 弱 | 全量 `ArrayBuffer` 常驻内存 + 全量落 IndexedDB，"大文件"实际只能扛到 ~百 MB 级 |
| 可用性/健壮性 | ⚠️ 中 | 取消不彻底、chunkSize 变化导致续传错位、孤儿分片无清理 |
| 安全性 | ⚠️ 中 | 服务端 CORS 全开、无限流；客户端鉴权注入存在**死配置与覆盖缺口** |
| 性能 | ⚠️ 中 | IndexedDB 全表串行扫描、Worker 日志洪水、合并期长事务 |
| 工程质量 | ✅ 良 | 分层清晰、Hook 拆分合理、lint 零告警；但**全局单例污染**是库化最大隐患 |
| 测试与发布 | ❌ 弱 | 12 个单测集中在纯函数层，Worker 协议/鉴权/下载链路零覆盖；发布流程有空包风险 |

**最需要优先处理的 5 件事**：
1. 下载分片请求完全没有鉴权头（P0-1）
2. 上传 `withCredentials` 是死配置（P0-2）
3. 全量 `ArrayBuffer` 内存/存储模型（P0-3）
4. 模块级全局单例（store / localforage / axios / workerPool）（P0-4）
5. chunkSize 自适应与服务端分片索引耦合导致的永久失败（P1-6）

---

## 1. 分析范围与方法

### 1.1 代码规模

| 区域 | 文件数 | 代码行数 | 说明 |
| --- | --- | --- | --- |
| `src/`（TS/TSX） | 78 | 10,464 | 上传模块 ~3.3k 行、下载模块 ~2.9k 行、Demo/共享 ~4.2k 行 |
| `server/src/`（JS） | 19 | 2,084 | 控制器 713 行、chunk 状态队列 249 行、SQLite 适配器 219 行 |
| `server/tests/` | 1 | 377 | 仅 file-api 集成测试 |
| `scripts/` | 5 | — | 契约校验、编码校验、指标采集、截图 |

最大的 5 个源文件（均为"上帝文件"嫌疑）：

```
645  src/components/ZustandFileDownload/components/FileList.tsx
574  src/components/ZustandFileUpload/hooks/useBatchUploaderController.ts
558  src/components/ZustandFileUpload/worker/uploadWorker.ts
470  src/App.tsx
440  src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts
```

### 1.2 本次实际执行的验证

| 命令 | 结果 |
| --- | --- |
| `npx eslint .` | ✅ 0 error / 0 warning（19s） |
| `npx vitest run` | ✅ 5 files / 12 tests 全部通过；但有 **2 个 Unhandled EPERM**（vitest 缓存目录写权限，环境噪声，非代码缺陷） |
| `npm run build`（lib） | ✅ 63 modules transformed，`dist/index.js` 172.62 kB（gzip 48.79）、`index.cjs` 123.82 kB；⚠️ 1 条 rollup 警告（见 P2-31）；注：默认会 `emptyOutDir`，本次环境被安全删除守卫拦截，改用 `--emptyOutDir false` 验证通过 |
| `npm run verify:server` | ❌ 未执行：`server/node_modules` 不存在，后端依赖未安装 |

---

## 2. 架构总览

### 2.1 分层

```
┌─ React 组件层 ──────────────────────────────────────────────┐
│ FileUpload(index.tsx) / FileDownload(index.tsx) / SimpleUploadList │
│   └── Context(Provider) → 透传 props                        │
├─ Hook 层 ───────────────────────────────────────────────────┤
│ useFileProcessor(选文件→预处理) / useBatchUploader(批次调度)  │
│ useFileOperations(增删改) / useNetworkDetection(网络探测)     │
├─ Service 层 ────────────────────────────────────────────────┤
│ uploadOrchestrator(并发队列) / uploadWorkerBridge(Worker池)   │
│ cleanupPolicy(自动清理) / ChunkPersistenceService / MergeService│
├─ Worker 层 ─────────────────────────────────────────────────┤
│ filePrepareWorker(MD5) / uploadWorker(秒传+分片+合并)         │
│ downloader.worker(Range 拉取) / merger.worker(Blob 合并)      │
├─ 存储层 ────────────────────────────────────────────────────┤
│ localforage 默认实例(upload_files) / fileStore·chunkStore·completeFileStore(fileDownloadTest) │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计决策与其代价

| 决策 | 收益 | 代价（本次发现的问题根因） |
| --- | --- | --- |
| Worker `?worker&inline` 内联为 Blob | 规避消费方 dev 下 worker 资产 404 | 包体积增大；Worker 代码失去独立缓存；`spark-md5` 无法 external |
| 文件全量读入 `ArrayBuffer` 再分片 | 实现简单、分片纯内存切片 | 内存 = 文件大小 × 并发数；无法支持 GB 级（P0-3） |
| `file_id = 全量 MD5` | 天然秒传、天然去重 | 同内容文件 id 冲突（P1-7）；大文件 MD5 耗时长 |
| 模块级 zustand 单例 store | Demo 内跨组件共享状态 | 库化后多实例互相污染（P0-4） |
| 模块级 `localforage.config()` | 一处配置 | 覆盖消费方默认实例，`clear()` 会误删宿主数据（P0-4） |
| chunkSize 由网络自适应（256KB~8MB） | 弱网体验 | 与服务端按 index 存分片耦合 → 变化后续传错位（P1-6） |
| 上传进度只记"分片完成数" | 简单 | 无字节级速度/剩余时间，取消后从 0 计（P2-31） |

---

## 3. 问题清单

> 严重度定义：**P0** = 阻断核心场景或造成数据/安全损失；**P1** = 明显功能缺口或性能塌陷；**P2** = 体验、可维护性、工程规范问题。

### P0 — 阻断级

#### P0-1　下载分片请求完全不带鉴权头

- **位置**：`src/components/ZustandFileDownload/worker/downloader.worker.ts:299-304`
- **现象**：`fetch(url, { headers: { Range } })` —— 只有 Range 头，无 `Authorization`、无 `credentials`。主线程 `setDownloadAuth()`（`api.client.ts:101`）只写入 **axios** 实例，而 axios 仅用于 `GET /list` 列表请求；真正的分片下载走 Worker 内的原生 `fetch`，两者**不是同一条链路**。
- **影响**：服务端一旦开启鉴权（`REQUIRE_FILE_AUTH=true`），所有分片请求必然 401；且前端 401 不会触发任何"重新登录"提示，表现为"点了下载就一直失败/分片缺失"。跨域 Cookie 模式同样失效（fetch 默认 `same-origin`）。
- **修复建议**：`START_DOWNLOAD` 消息增加 `authHeaders` / `withCredentials` 字段（与上传侧 `resolveAuthHeaders` 共用语义），Worker 内合并进 `fetch` 的 `headers` 与 `credentials`；`FileDownload` 组件补齐 `getAuthToken/getAuthHeaders/withCredentials` props。

#### P0-2　上传 `withCredentials` 是死配置（Cookie 鉴权模式无法开启）

- **位置**：`src/components/ZustandFileUpload/context/UploadContext.tsx:49-107`
- **现象**：`UploadProvider` 解构了 `authToken/getAuthToken/getAuthHeaders/authScheme`，**唯独漏了 `withCredentials`**，也未写入 `value`。下游 `useEffectiveConfig.ts:76` 读到的恒为 `undefined` → `uploadWorker.ts:223` 恒为 `"same-origin"`。
- **影响**：`types/upload.ts:119`、`utils/auth.ts:22`、`uploadWorkerBridge.ts:22` 三处都声明了该能力，但链路断在 Provider → **文档承诺的"同域/跨域 Cookie 鉴权"实际不可用**。
- **修复建议**：Provider 补上 `withCredentials = false` 解构与透传；并在 `docs/components.md` 明确三种鉴权方式的组合矩阵。

#### P0-3　全量 ArrayBuffer 内存/存储模型 → "大文件"名不副实

- **位置**：`worker/filePrepareWorker.ts:92,112`（`file.arrayBuffer()` 后整包塞进 `UploadFile.buffer`）；`hooks/useFileProcessor.ts:230`（写入 localforage）；`hooks/useBatchUploaderController.ts:194`（每次任务全量 `getItem` 反序列化）；`services/uploadWorkerBridge.ts:199`（`postMessage` transfer）
- **现象**：一个文件的完整二进制同时存在于：① Worker 内存 ② 主线程内存 ③ IndexedDB 三处；批次并发 4 时峰值 ≈ 4×文件大小。SparkMD5 也是一次性 `append(全量 buffer)`（:50）。
- **影响**：
  - 500MB 文件 × 4 并发 → 2GB 内存峰值，标签页直接 OOM；
  - IndexedDB 写入配额（通常几百 MB~数 GB）触顶后 `QuotaExceededError`，刷新续传随即失效；
  - MD5 与分片 MD5 计算为同步循环（`uploadWorker.ts:265-276`），阻塞 Worker。
- **修复建议**：改为 **File.slice 流式分片**：`file.slice(start,end).arrayBuffer()` 逐片读 → 增量 SparkMD5（首尾片 + 采样）→ 分片上传完即释放；IndexedDB 只存元数据 + 未完成分片的 Blob（或直接持久 File/FileHandle），不再存整包 buffer。这是架构级改造，建议单独立项。

#### P0-4　模块级全局单例污染（库化的最大隐患）

| 单例 | 位置 | 风险 |
| --- | --- | --- |
| zustand store | `store/upload.ts:88` `create()` | 同页两个 `<FileUpload/>` 共享文件列表、并发度、批次状态 |
| localforage 默认实例 | `index.tsx:25-28` 模块级 `localforage.config()` | 覆盖消费方默认配置；`useFileOperations.ts:80` 的 `localforage.clear()` 会**清空宿主共用库的全部数据** |
| axios + runtimeConfig | `api.client.ts:63-79` | 多个 `FileDownload` 实例互相覆盖 baseURL/auth |
| workerPool | `uploadWorkerBridge.ts:45-46` | 任一组件卸载即 `disposeUploadWorkerPool()` 销毁全部 worker（:153） |

- **额外**：`package.json` 声明 `"sideEffects": false`，但 import 即执行 `localforage.config()` 与 store 创建 → Tree-shaking 可能误删副作用，语义矛盾。
- **修复建议**：store 改为 `createStore` + Context 注入；localforage 一律使用 `createInstance({ name: 'react-upload-indexeddb', storeName: ... })` 具名实例，禁用默认实例与 `clear()`；workerPool 改为引用计数。

### P1 — 严重

#### P1-5　merge API 路径硬编码，baseURL 拼接无归一化

- **位置**：`worker/uploadWorker.ts:456` `${baseURL}/api/file/merge`（`uploadApi/checkApi` 可配，`mergeApi` 不可配）
- **影响**：网关前缀/版本化路径/自定义协议场景必然 404，且失败信息不直观。另：`${baseURL}${checkApi}` 未做斜杠归一化，`baseURL` 带尾斜杠会产生 `//api/...`。
- **建议**：新增 `mergeApi` prop，与 `uploadApi/checkApi` 同级；统一 `joinUrl(base, path)` 工具。

#### P1-6　chunkSize 自适应变化 → 续传永久失败

- **位置**：`shared/networkStrategy.ts:74-92`（256KB~8MB 自适应）；`uploadWorker.ts:245`（用 `fileInfo.chunkSize`）
- **现象**：`file_id = 内容 MD5`，服务端按 `index + chunk_md5` 落库（`uploadController.js:312-337`）。若首次用 4MB 分片传了一半，网络变差后 chunkSize 变 1MB 重试 —— 同一 `index` 的字节范围已变，服务端校验 `chunk_md5` 不匹配 → **400/409**，而前端仅对 5xx 重试（`uploadWorker.ts:163`），于是该任务永久卡死。
- **建议**：`file_id` 引入 `size + chunkSize` 维度（如 `${md5}_${size}_${chunkSize}`），或服务端按 `file_id + chunkSize` 分桶；`instantCheck` 同时校验 `size` 一致性。

#### P1-7　相同内容文件 id 冲突

- **位置**：`worker/filePrepareWorker.ts:94` `const id = hash`
- **影响**：一次选择两个内容相同的文件（常见于测试/备份），第二个覆盖第一个，列表只剩一条；秒传语义也会把"同名不同内容"以外的场景混淆。
- **建议**：`id = ${hash}_${size}_${lastModified}_${randomUUID()}`，秒传仍用 `md5` 判定。

#### P1-8　取消上传不彻底

- **位置**：`services/uploadWorkerBridge.ts:115-123`（仅 resolve 结果）；Worker 内 `fetch` 未接入 `AbortSignal`
- **影响**：`cancelUpload` 后网络请求仍在跑，占用带宽与服务端资源；状态被置回 `QUEUED` 但 IndexedDB 里 buffer 仍在，内存不释放。
- **建议**：Worker 增加 `CANCEL` 消息协议（参照下载侧 `handleCancel`），在 `fetchWithRetry` 中传入并 propagate signal。

#### P1-9　资源/定时器泄漏

- `uploadWorker.ts:104-107`：`timeoutId` 仅在成功分支 `clearTimeout`；5xx 重试分支（:164-169）超时器遗留。
- `hooks/useFileProcessor.ts:250`：`setTimeout(() => void uploadAll(), 500)` 无清理，组件卸载后仍触发上传。
- `services/cleanupPolicy.ts:200-222`：`setInterval` + `setTimeout` 双机制触发 `executeCleanup`，语义重叠、易漂移。
- **建议**：统一 `finally { clearTimeout(timeoutId) }`；定时器句柄登记 + 卸载清理；countdown 只保留 interval。

#### P1-10　Worker 日志洪水

- **位置**：`worker/uploadWorker.ts:29-37` 每个 `debug()` 都 `console.log` + `postMessage({type:'debug'})`
- **影响**：1000 分片文件会产生数千条跨线程消息与控制台输出，主线程消息队列被挤占（这也是大文件"越传越卡"的隐藏原因）；生产包携带调试噪音。
- **建议**：增加 `debug?: boolean` 开关（默认关），日志合并节流后批量 postMessage。

#### P1-11　下载侧 IndexedDB 全表串行扫描

- **位置**：`services/chunkPersistenceService.ts:53-139`（`getChunkHealth/getPendingChunks/countDownloadedChunks/collectChunks` 全部 `for + await getItem`）；`hooks/useDownloadFiles.ts:56-68`（拉全量 keys 后逐个 getItem）
- **影响**：500 分片 = 500 次串行事务往返，秒级卡顿；列表每次刷新重复一遍。
- **建议**：改用 `chunkStore.iterate()` 单次游标，或用 `getItems(keys)` 批量读；维护"已完成分片索引集合"元数据，避免全表探测。

#### P1-12　下载空间双份占用 + 用量统计不准

- **位置**：`services/downloadEventHandlers.ts:80`（合并后写入 `completeFileStore`）+ 分片仍留在 `chunkStore`；`hooks/useStorageManager.ts:59` 用 `JSON.stringify(file).length` 估算元数据大小
- **影响**：一个 1GB 文件下载完成后占用约 2GB；`StorageStats` 展示值与实际偏差大。
- **建议**：合并成功后异步清理该文件的分片；用量统计改用 `navigator.storage.estimate()` 或按 Blob.size 累加。

#### P1-13　服务端：合并期长事务、孤儿分片、CORS/限流缺失

- `controllers/uploadController.js:318-343`：事务内做 `readFile + appendFile`（N 次同步 IO）+ `md5File`（第二次全量 IO），长事务持 SQLite 写锁，并发合并互相阻塞。
- `services/chunkStateQueue.js`：分片状态先内存后批量落盘（默认 180ms / 120 条），**进程在 flush 前崩溃 = 磁盘有分片、DB 无记录 → merge 报 `chunk not found`**，无恢复机制与对应测试。
- `tmp/upload/` 孤儿分片（上传中断、合并失败）无定时清理任务 → 磁盘单调增长。
- `middleware/uploadChunk.js:6`：multer `fileSize` 硬编码 20MB，不可配；前端自适应最大 8MB，余量小。
- `app.js:9`：`cors()` 全开无白名单；无 helmet、无限流、无上传总量限制。
- `controllers/downloadController.js:274`：`createReadStream().pipe(res)` 未监听 `req` 的 `close/aborted`，客户端中断后流不销毁 → 句柄泄漏。

#### P1-14　下载列表：全目录扫描 + 可放大的 DoS 面

- `controllers/downloadController.js:143-206`：`collectAllFiles()` 每次 `readdir + stat`，未命中缓存时还要 `calculatePartialMd5Async`；`findFileById` 未命中就全量重扫；`fileIdCache` 无容量上限。
- **影响**：构造大量随机 `file_id` 请求可把每次请求放大为"全目录 stat + 部分文件 MD5"，形成 IO 型 DoS；文件列表无分页，文件数增长后 `/list` 线性变慢。
- **建议**：`fileId` 改为基于 DB 记录而非绝对路径 hash；列表结果加 TTL 缓存；`file_id` 加格式白名单校验；加分页。

### P2 — 一般 / 体验 / 工程

| 编号 | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| P2-15 | `UploadStatus` 10 个状态中 `CALCULATING/PAUSED/MERGE_ERROR` 基本未被写入；**暂停功能无实现路径**（Worker 协议里没有 pause） | `types/upload.ts:5-26` | 收敛状态机；要么实现 pause，要么从类型与 UI 移除 |
| P2-16 | 直接修改共享对象：`file.status = ...; localforage.setItem(file.id, file)`，随后又 `getItem` 取 `latest`（可能同一引用），并发批次下状态覆盖竞态 | `useBatchUploaderController.ts:186-267` | 改为不可变更新 + 乐观锁（版本号） |
| P2-17 | `cleanupCompletedFilesFromIndexedDB` 只清 `completedFileIds`，`ERROR/QUEUED` 残留文件永不清理 | `services/cleanupPolicy.ts:116-143` | 增加 TTL（如 7 天）与容量上限的淘汰策略 |
| P2-18 | localStorage 键名无命名空间（`autoUpload`/`cleanupDelay`/`networkDisplayMode`），且 `settingsSource='props'` 时仍写入 | `store/upload.ts:141-156` | 前缀 `react-upload-indexeddb:`；props 模式禁写 |
| P2-19 | 文档与实现矛盾：README:251 仍写"上传 Worker `credentials:'include'`、下载 axios `withCredentials:true`"，与 v1.0.5 的实际默认（`same-origin` / `false`）**完全相反**；`docs/components.md` 无鉴权章节 | `README.md:246-283` | 随 P0-1/P0-2 修复同步重写 |
| P2-20 | 发布流程有空包风险：`files:["dist"]` 且 `dist` 已 gitignore，无 `prepublishOnly`/`prepack` 钩子；无 CHANGELOG | `package.json:27-30` | 加 `"prepublishOnly": "npm run build"`；补 CHANGELOG |
| P2-21 | `server/package.json` 依赖 `"react-upload-indexeddb": "file:.."` —— 服务端 Demo 反向依赖自身库包，语义错误且会造成循环安装 | `server/package.json` | 删除该依赖 |
| P2-22 | 仓库污染：`.lh/`（行号缓存 JSON，含大量已删除的历史路径快照）被提交入库 | `.lh/**` | 删除并加入 .gitignore |
| P2-23 | 测试覆盖严重不足：12 个用例集中在纯函数层（store / orchestrator / networkStrategy）；**Worker 协议、鉴权解析、cleanupPolicy、下载分片与断点恢复全部为零覆盖**；已装 playwright 但无 e2e；server 依赖未安装导致 `npm run verify` 实际跑不通 | `src/**/*.test.*` | 见第 5 节路线图 |
| P2-24 | 401/403 无差异化处理：既不重试也不提示重新登录，只抛通用错误 | `worker/uploadWorker.ts:162-172` | 增加 `onAuthError` 回调 |
| P2-25 | antd 静态 `message`：`store/upload.ts:204` `getMessageApi: () => message`、多处直接 import；不消费 `ConfigProvider` 上下文（主题/暗色/prefixCls 失效），antd v5 有弃用警告 | 多处 | 改用 `App.useApp()` 或允许宿主注入 |
| P2-26 | 上传进度只按分片数计算，无字节速率/剩余时间；取消重试后从 0 开始 | `uploadWorker.ts:396-407` | 改为字节级进度 |
| P2-27 | UI 细节：`<center>` 标签（下载 `index.tsx:32`）、中文文案硬编码无法定制（无 `locale` prop）、`destroyOnHidden` 为 antd 5.25+ API（低于该版本无效） | 多处 | 语义化标签 + 文案可注入 |
| P2-28 | `SimpleUploadList.handleBatchComplete` 无条件 `removeUploadFilesByIds(batchIds)`，**失败文件也被静默删除** | `SimpleUploadList.tsx:161-169` | 仅删除成功项 |
| P2-29 | `configureDownloadApi` 在每次 mount 时把 `withCredentials` 重置为 `false`，会覆盖用户此前 `setDownloadAuth` / 手动开启的 Cookie 配置 | `FileDownload/index.tsx:55-61` | 缺省值改为"保留现有值" |
| P2-30 | 秒传请求体一次性携带全部 `chunk_md5s`（`total` 可达数千），`express.json` 限制 20MB；分片越小、文件越大越容易触顶 | `worker/uploadWorker.ts:284-291` | 改为按批查询，或服务端支持 `chunk_md5s` 分页校验 |
| P2-31 | 入口同时导出 named + default（`src/index.ts:2-3`），rollup 警告：CJS 消费方必须 `require(...).default` 才能拿到组件，与 v1.0.2 "纯 drop-in 替换"的意图冲突 | `src/index.ts`、`vite.lib.config.ts` | 设 `output.exports: 'named'` 且 CJS 下把 default 赋值到 `module.exports`，或明确文档化 `.default` 用法 |

---

## 4. 按类别交叉索引

| 类别 | 问题编号 |
| --- | --- |
| 功能缺陷 | P0-1、P0-2、P1-6、P1-7、P1-8、P2-15、P2-24、P2-28、P2-29 |
| 架构 / 内存 | P0-3、P0-4、P1-11、P1-12 |
| 并发 / 状态一致性 | P1-6、P1-8、P1-9、P1-13、P2-15、P2-16、P2-17 |
| 安全 | P0-1、P1-13（CORS/限流）、P1-14（DoS 面）、P2-18 |
| 性能 | P0-3、P1-10、P1-11、P1-13、P1-14、P2-26、P2-30 |
| 工程 / 发布 | P0-4（sideEffects）、P2-20、P2-21、P2-22、P2-23 |
| 文档一致性 | P2-19、P2-23（README 命令不可执行） |
| 体验 / 可维护性 | P2-24 ~ P2-27 |

---

## 5. 修复路线图

### 阶段一：止血（建议 1～2 天，全为低风险改动）

1. **P0-1** 下载 Worker 注入 `authHeaders` / `credentials`（新增字段 + `FileDownload` props）。
2. **P0-2** `UploadProvider` 透传 `withCredentials`。
3. **P2-19** 同步订正 README 鉴权章节（把 `same-origin` / 默认 false 写清楚）。
4. **P2-29** `configureDownloadApi` 缺省保留现值。
5. **P2-28** 简化模式仅清理成功文件。
6. **P1-9** 补 `clearTimeout` 与卸载清理。
7. **P2-20 / P2-21 / P2-22** 发布钩子、依赖与仓库清理。

> 阶段一完成后，鉴权链路（Bearar + Cookie）才算真正端到端可用。

### 阶段二：健壮性（建议 1 周）

8. **P1-5** `mergeApi` 可配 + URL 归一化。
9. **P1-6 / P1-7** `file_id` 引入 `size + chunkSize + 唯一后缀`，服务端 `instantCheck` 校验 size。
10. **P1-8** Worker `CANCEL` 协议，取消真正终止 fetch。
11. **P1-10** 日志开关 + 节流。
12. **P1-11 / P1-12** 下载侧批量读 + 合并后清理分片 + 用量统计修正。
13. **P1-13** 合并移出事务（先落盘校验再开事务）、孤儿分片清理任务、multer 限额可配、CORS 白名单 + 限流 + 流销毁。
14. **P1-14** 列表缓存 + 分页 + `file_id` 格式校验 + 缓存容量上限。
15. **P2-23** 补测试：鉴权解析、Worker 协议 mock、cleanupPolicy、下载断点恢复；恢复 `server` 依赖安装并纳入 CI。

### 阶段三：架构升级（建议 2～3 周，需单独立项）

16. **P0-3** 流式分片 + 采样哈希 + 分片级持久化，去掉整包 `ArrayBuffer`。
17. **P0-4** store Context 化、localforage 具名实例、worker 池引用计数、`sideEffects` 声明与实际对齐。
18. **P2-15** 状态机收敛 + 真正的暂停/恢复协议。
19. **P2-26** 字节级进度与速率估算。

---

## 6. 附录

### 附录 A：构建验证输出

```
$ npx vite build --config vite.lib.config.ts --emptyOutDir false
vite v5.4.19 building for production...
✓ 63 modules transformed.
dist/index.js   172.62 kB │ gzip: 48.79 kB │ map: 374.36 kB
Entry module "src/index.ts" is using named and default exports together.
Consumers of your bundle will have to use `chunk.default` to access the default export.
dist/index.cjs  123.82 kB │ gzip: 41.85 kB │ map: 357.24 kB
✓ built in 993ms
```

说明：
- 产物体积中包含了**内联的 4 个 Worker** 与 `spark-md5`，这是"消费方 dev 不 404"所付出的固定成本，属已知取舍。
- `npm run build` 在本机默认路径会先 `emptyOutDir`（删除 `dist/` 下 62 个旧产物），被环境的批量删除守卫拦截，**不是代码问题**；CI 或本地手工确认后即可正常执行。

### 附录 B：关键文件速查

| 关注点 | 入口文件 |
| --- | --- |
| 上传主流程 | `src/components/ZustandFileUpload/hooks/useBatchUploaderController.ts` |
| 上传网络层 | `src/components/ZustandFileUpload/worker/uploadWorker.ts` |
| 鉴权解析 | `src/components/ZustandFileUpload/utils/auth.ts` |
| 下载网络层 | `src/components/ZustandFileDownload/worker/downloader.worker.ts` |
| 下载调度 | `src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts` |
| 网络自适应 | `src/shared/networkStrategy.ts` |
| 服务端上传 | `server/src/controllers/uploadController.js` |
| 服务端下载 | `server/src/controllers/downloadController.js` |
| 分片状态队列 | `server/src/services/chunkStateQueue.js` |
