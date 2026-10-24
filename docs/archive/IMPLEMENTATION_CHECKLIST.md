# 实施清单：react-upload-indexeddb 质量提升

> ⚠️ 历史归档（v2.0.x 质量提升记录）。任务均已落地或失效，现行文档见 [../README.md](../README.md)、[../architecture.md](../architecture.md)、[../components.md](../components.md)。

> 配套文档：[`PROJECT_ANALYSIS.md`](./PROJECT_ANALYSIS.md)（全面分析）
> 目标版本区间：在保持 **公共 API 稳定**（不影响 v2.0.x 消费方）的前提下落地。
> 通用验收门槛：每次改动后 `npm run verify:client`（lint + build + 128 测试）必须全绿；UI 改动需在 demo（`npm run dev`）实测无回退。

## 0. 跟踪总表

| #   | 标题                                 | 阶段  | 工作量 | 状态                                                                        |
| --- | ------------------------------------ | ----- | ------ | --------------------------------------------------------------------------- |
| 1   | 长列表渲染优化（content-visibility） | 一·高 | S      | ✅ 已实施                                                                   |
| 2   | NetworkStatusBadge 拆分瘦身          | 二·中 | M      | ✅ 已实施（面板抽至 NetworkStatusPanel.tsx）                                |
| 3   | 两个 Controller 编排/业务拆分        | 二·中 | M      | ✅ 已实施                                                                   |
| 4   | 可关闭 debug logger 替换 console.\*  | 二·中 | M      | ✅ 已实施                                                                   |
| 5   | 修正 vite.lib.config.ts 过时注释     | 二·中 | S      | ✅ 已实施                                                                   |
| 6   | 列表行 memo + 派生布尔选择器         | 三·低 | S      | ✅ 已实施                                                                   |
| 7   | 收敛文件列表刷新入口去重拉取         | 三·低 | M      | ✅ 已实施（api.client 并发去重 + 2 测试）                                   |
| 8   | server auth 默认安全 + README 提示   | 三·低 | S      | ✅ 已实施（README 安全提示 + server 默认 fail-closed 代码变更，2026-10-24） |
| 9   | vitest 提速（--no-isolate）          | 三·低 | S      | ✅ 已实施                                                                   |

> 工作量：S ≤ 0.5d，M ≈ 0.5–1d。建议每完成一项即提交一次（小步可审），不要攒成大 PR。

---

## 阶段一 · 高优先级（渲染性能）

### ✅ #1 长列表渲染优化

**问题**：`FileList.tsx`(645) 与 `FileTable.tsx`(234) 全量渲染文件/分片行，数量大时首屏与滚动卡顿（分析 §4.6 / §10-#1）。

**涉及文件**

- `src/components/ZustandFileDownload/components/FileList.tsx`
- `src/components/ZustandFileUpload/components/FileTable.tsx`
- `src/ui/ui.css`（或对应组件样式）

**具体步骤**

1. 定位列表行（row）包裹元素（`<tr>` / `<div class="rui-...">`）。
2. 为行加 CSS：`content-visibility: auto; contain-intrinsic-size: auto 44px;`（高度按实际行高填）。
   - 若行是 `<tr>`，`content-visibility` 对 table 行支持有限，退而求其次：给 `<tbody>` 容器加 `contain: content` 或在行外层包 `<div>` 虚拟化容器。
3. 仅对**可能超长**的列表启用；demo 小列表无副作用。
4. （可选，后续）若实测仍卡，评估引入轻量窗口化（如 `@tanstack/react-virtual`），但会引入依赖——单独评估，不在本项内强求。

**验收标准**

- 渲染 200+ 条文件列表时 DevTools Performance 无长任务（>50ms）尖峰；滚动流畅。
- 视觉无回退（行高占位正确，无闪烁/错位）；`verify:client` 全绿。

**依赖**：无。可独立最先落地。

---

## 阶段二 · 中优先级（精简性 / 库卫生 / 规范）

### ✅ #2 NetworkStatusBadge 拆分瘦身

**问题**：`NetworkStatusBadge.tsx` 404 行却名为"徽章"，疑似混入完整网络面板（分析 §6.1 / §10-#2）。

**涉及文件**

- `src/components/ZustandFileDownload/components/NetworkStatusBadge.tsx`（现状 404 → 重构后 ~200，仍是徽章本体 + 工具栏 + 紧凑/悬浮两种展示）
- 新建 `src/components/ZustandFileDownload/components/NetworkStatusPanel.tsx`（~216，承接"网络设置"对话框：分片大小/文件并发/分片并发滑块调节）
- 引用处（`ZustandFileDownload/index.tsx` 等）无需改动——导出名与 props 不变

**具体步骤**

1. 通读该文件，识别非徽章本体的"网络设置"对话框（Modal + 三组 Slider/InputNumber，约 135 行）。
2. 将这块面板逻辑抽至 `NetworkStatusPanel.tsx`，本地编辑态自管，确认时通过 `onApply` 把值交回徽章侧 `updateNetworkStatus` + 必要时 `onRefreshFiles`。
3. `NetworkStatusBadge` 仅保留：状态点 + 文案、compact/tooltip 两种展示（`renderContent`）、三个工具栏按钮（切换显示模式 / 锁定设置 / 打开设置面板）与触发入口。
4. 保持 `export const NetworkStatusBadge` 签名与渲染位置不变（`showNetworkStatus` 行为不变）。

**验收标准**

- 重活（设置对话框）独立到 `NetworkStatusPanel`，可单独测试；徽章文件大幅瘦身、职责单一。
- 功能等价：demo 中"网络状态徽章"显示 / 展开设置面板的行为与重构前一致（需 demo 实测截图对比）。
- `verify:client` 全绿，无新增 `any`。

**依赖**：无。已完成。

> 注：徽章保留的 compact/tooltip `renderContent` 属徽章本体展示，故未硬压到 120 行；核心收益（面板逻辑解耦）已达成。

### ✅ #3 两个 Controller 编排/业务拆分

**问题**：`useBatchUploaderController.ts`(709) 与 `useFileDownloaderController.ts`(466) 编排（worker 生命周期/监听）与业务（策略计算/状态变换）混杂（分析 §6.1 / §10-#3）。

**已实施（2026-10-24）**：按"Lifecycle（编排）/ Policy（业务）"两类职责拆分，原 hook 作为只做编排的薄壳，公开签名与返回值 100% 不变（`useBatchUploader`/`BatchUploaderActions`/`useFileDownloader` 均经 `verify:client` + client-contract 校验）。

**新增文件（均 ≤400 行）**

- `ZustandFileUpload/hooks/uploadPolicy.ts`：纯函数 `BatchInfo` reducer（`createInitialBatchInfo`/`applyBeforeEach`/`applySettled`/`applyFinalized`/`withClearedCountdown`）+ `classifyUploadResult`（worker 结果 → 状态机分支判别），无 React/engine 副作用。
- `ZustandFileUpload/hooks/useUploaderLifecycle.ts`：抽出 abort 会话、刷新节流调度、autoCleanup + 卸载销毁两个 effect 与 `cleanupPolicy` 创建，返回编排句柄。
- `ZustandFileDownload/hooks/downloadPolicy.ts`：纯函数 `normalizeDownloadFile` + `buildStartDownloadMessage` + `buildUpdateConcurrencyMessage`。
- `ZustandFileDownload/hooks/useDownloaderLifecycle.ts`：抽出 download/merge worker 创建、onmessage 路由与 terminate 清理 effect，返回两个 worker ref。

**验证**：`npm run verify:client` 全绿（lint 0 / lib build / 130 测试 / client-contract）；公开 API 零变化。

**涉及文件**

- `src/components/ZustandFileUpload/hooks/useBatchUploaderController.ts`
- `src/components/ZustandFileDownload/hooks/useFileDownloaderController.ts`

**具体步骤**

1. 对每个文件，划分两类职责：
   - **Lifecycle（编排）**：worker 创建/terminate、`onmessage` 绑定、effect 注册/清理、对外暴露的命令式 API。
   - **Policy（业务）**：并发/分片策略计算、进度聚合、状态机迁移、store 写入转换。
2. 抽出 `useXxxLifecycle()` 与 `XxxPolicy`（纯函数或轻 hook），原 hook 作为**只做编排的薄壳**，签名与返回值保持不变。
3. 保持 hook 对外的 props/返回值 100% 不变（这是硬约束，否则破坏消费方）。

**验收标准**

- 拆分后每个新文件 ≤ 400 行；原 hook 公开签名零变化。
- 现有 128 测试无需改断言即通过（若测试直接 import 内部函数，需同步调整路径）。
- demo 上传/下载全流程实测无行为差异。

**依赖**：#2 可并行；本项独立但风险较高，建议单独 PR + 人工复核。

### ✅ #4 可关闭 debug logger 替换 console.\*

**问题**：库源码 42 处 `console.*`（主要集中在 `clearIndexedDB.ts` 13 / `downloader.worker.ts` 8 / `storage.ts` 6），生产环境噪声不可控（分析 §6.2 / §10-#4）。

**涉及文件**

- 新建 `src/shared/debugLogger.ts`（或 `src/utils/debugLogger.ts`）
- `src/utils/clearIndexedDB.ts`、`src/components/ZustandFileDownload/worker/downloader.worker.ts`、`src/components/ZustandFileDownload/utils/storage.ts`、其余含 `console.*` 的库文件（App.tsx/DebugPanel 属 demo，不动）。

**具体步骤**

1. 实现 logger：
   ```ts
   let silent = true; // 库默认静默，避免生产噪声
   export const configureDebug = (opt: { silent?: boolean }) => {
     silent = opt.silent ?? silent;
   };
   export const debugLog = (...a: unknown[]) => {
     if (!silent) console.debug("[rui]", ...a);
   };
   export const debugWarn = (...a: unknown[]) => {
     if (!silent) console.warn("[rui]", ...a);
   };
   export const debugError = (...a: unknown[]) => {
     console.error("[rui]", ...a);
   }; // 真实失败始终记录
   ```
2. 替换规则：真实异常分支用 `debugError`；调试/重试提示用 `debugWarn`/`debugLog`；保留 `console.error` 仅用于不可恢复失败。
3. worker 内无法 import DOM 侧 logger 时，把 logger 逻辑也 inline 进 worker（或 worker 内独立的轻量 `silent` 开关）。
4. 在 `index.ts` 导出 `configureDebug`，写进 README 的"调试"小节。

**验收标准**

- 默认 `silent=true` 时，正常上传/下载流程控制台**无** `[rui]` 噪声；仅真实失败出现 `console.error`。
- 消费方调用 `configureDebug({ silent:false })` 可恢复全部日志。
- `verify:client` 全绿。

**依赖**：无。可独立落地。

### ✅ #5 修正 vite.lib.config.ts 过时注释

**问题**：注释声称 worker 用 `new URL('...', import.meta.url)`，实际代码已改为 `?worker&inline`（分析 §2.3 / §10-#5）。

**涉及文件**

- `vite.lib.config.ts`（第 11–15 行注释块）

**具体步骤**

1. 将注释改为：worker 经 `?worker&inline` 内联为 Blob（引用 `useFileProcessor.ts`、`uploadWorkerBridge.ts`、`ZustandFileDownload/worker/index.ts`）。
2. 保留 `base: "./"` 的原有正确性说明（仍适用）。

**验收标准**：注释与 `src/**/*?worker&inline` 实际用法一致；无代码改动，`build` 仍通过。

**依赖**：无。最小改动项，可顺手提交。

---

## 阶段三 · 低优先级（打磨）

### ✅ #6 列表行 memo + 派生布尔选择器

**问题**：`React.memo` 仅 2 处，列表行可能高频重渲染；可见性开关应避免整体对象订阅（分析 §4.5 / §10-#6）。

**涉及文件**

- `FileList.tsx` / `FileTable.tsx` 的行组件
- 各组件内 `useXxxStore((s) => s.showXxx)` 等处

**具体步骤**

1. 对行组件包 `React.memo`（确保 props 为稳定引用/基本类型）。
2. 将 `const x = useStore(s => s.obj); const visible = x.flag;` 改为 `useStore(s => s.obj.flag)`（直接订阅派生布尔），减少无关更新。

**验收标准**：开启 React DevTools 高亮，切换可见性开关时仅目标子树重渲染；`verify:client` 全绿。

**依赖**：#1 之后做更顺。

### #7 收敛文件列表刷新入口

**问题**：`getFileList` 调用分散在 `store`/`hooks`/`api.client`，存在重复拉取（分析 §4.4 / §10-#7）。

**涉及文件**

- `src/components/ZustandFileDownload/hooks/useDownloadFiles.ts`（作为单一入口）
- `src/components/ZustandFileDownload/store/index.ts`、`api.client.ts` 中冗余调用点

**具体步骤**

1. 确认 `useDownloadFiles` 为唯一"拉取+缓存"入口；其余处改为复用其返回/触发函数，不各自 `fetch`。
2. 若需跨组件共享，提升为单例 cache 或挂到 store（避免多实例各拉一次）。
3. 不引入新依赖（不引 SWR/TanStack）。

**验收标准**：一次页面加载中 `/api/file/list` 调用次数下降、且无重复并发；下载列表数据一致；`verify:client` 全绿。

**依赖**：可独立，但需谨慎核对调用点。

### #8 server auth 默认安全 + README 提示

**问题**：配套 server `middleware/auth.js` 默认关闭（分析 §7 / §10-#8）。

**涉及文件**

- `server/middleware/auth.js`（评估 fail-closed 默认）
- `README.md` / `docs/components.md`（显著提示消费方必须启用鉴权）

**具体步骤**

1. README 增加"安全部署"小节：明确 demo server 鉴权默认关闭，**生产必须启用**。
2. （已实施 2026-10-24）将 server 鉴权默认值改为 fail-closed（拒绝优先）：
   - `middleware/auth.js`：`createAuthMiddleware` 新增 `requireAuth`（默认 `true`）；移除旧的 `enabled===false` 静默放行分支——挂载即要求鉴权，未拿到有效凭据一律 401，唯一的放开口子是显式 `requireAuth:false`。
   - `app.js`：`REQUIRE_FILE_AUTH=true` 时永远以 `requireAuth:true` 挂载；若设了开关却未配置 `FILE_AUTH_TOKEN`/`FILE_AUTH_COOKIE`，打印 `FATAL` 告警且所有 `/api/file` 请求返回 401（避免 silent open）。
   - 默认关闭（`REQUIRE_FILE_AUTH` 未设/`false`）时接口完全开放，demo / 集成测试不受影响。
   - 新增回归测试 `tests/auth-middleware.test.js`（纯单元）+ `tests/auth-app.test.js`（app 级 misconfig→401）。

**验收标准**：README 有醒目安全提示；server 测试 39/39 全绿（含 10 个新增鉴权用例）；demo 默认行为不变（无 `REQUIRE_FILE_AUTH` 仍开放）。

**依赖**：需用户确认 server 默认策略变更意向。

### ✅ #9 vitest 提速

**问题**：24 文件各 spawn worker（~3.28s/个），且偶发 "failed to find the current suite"（分析 §8 / §10-#9）。

**涉及文件**

- `package.json` 的 `test:unit` 脚本
- CI 配置（如有）

**具体步骤**

1. `test:unit` 改为 `vitest run --no-isolate`（复用 worker，省约 8s）。
2. 固定 `vitest` 版本于 lockfile，避免 setup 偶发失败。
3. 本地验证 `verify:client` 仍全绿。

**验收标准**：`npm run test:unit` 耗时下降、无 setup 偶发失败；128 测试全绿。

**依赖**：无。

---

## 落地顺序建议

```
#1（高，独立，零风险） → #5（顺手）→ #4（库卫生，独立）
                              ↓
#2（中，独立）→ #3（中，需单独 PR + 人工复核）
                              ↓
#6 → #7 → #8（需确认）→ #9（收尾工具链）
```

- **必须先做**：#1、#4、#5（低风险、独立、立即收益）。
- **需谨慎/单独评审**：#3（签名稳定性硬约束）、#7（调用点核对）。
- **需用户拍板**：#8 的 server 默认策略变更；#7 是否引入窗口化依赖。

## 通用回滚与质量门

- 每项为独立 commit；若某项引入回归，`git revert` 单笔即可，不连累其他。
- 硬性门禁：`npm run verify:client` 全绿 + UI 改动 demo 实测截图对比。
- 不做"顺手大重构"：保持分析文档 §3 所列公共 API（`showXxx`/`autoStart`/`auth*`）与子路径 exports 完全稳定。
