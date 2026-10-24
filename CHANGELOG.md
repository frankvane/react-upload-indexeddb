# Change Log

本项目的所有显著变更都会记录在本文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Security
- **服务端鉴权默认 secure（fail-closed）**：`server/src/app.js` 新增 `AUTH_MODE`（`secure` 默认 / `demo` 关闭）。`secure` 下始终挂载鉴权中间件且 `requireAuth:true`，即便未配置任何凭据也一律 `401`，彻底消除"开了开关却 silently 全开"；仅 `AUTH_MODE=demo` 用于本机 / 内网联调。
- **CORS 默认关闭 + 显式白名单**：不再默认反射任意 Origin；仅当显式设置 `CORS_ORIGIN`（逗号分隔具体域名，不支持通配 `*`）时才启用，且可携带 Cookie 凭据。
- **错误响应脱敏**：全局错误处理器在生产环境仅返通用文案，真实堆栈 / 路径落服务端日志，不回传客户端（防信息泄漏）。
- **安全响应头 + 指纹收敛**：关闭 `X-Powered-By`，补充 `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` / `Cross-Origin-Resource-Policy`。
- **auth 中间件加固**：Cookie 解析 `decodeURIComponent` 包 try/catch（畸形 Cookie 不再 500）；Bearer 令牌比较改用 `crypto.timingSafeEqual` 定长比较（抗时序攻击）；预检 `OPTIONS` 请求跳过鉴权，避免阻断跨域预检。
- **S2 秒传防污染**：合并阶段以服务端计算的真实全量 md5 为权威去重键落库（不再信任客户端可能传入的 sample 采样哈希），并在合并后强制校验文件体积与声明一致；`full` 模式继续校验声明 md5，`sample` 模式跳过声明比对但仍以真实全量 md5 去重，杜绝采样哈希碰撞导致的误秒传 / 文件污染。
- **S3 容量 / 分片数上限（DoS 防护）**：新增 `MAX_UPLOAD_SIZE_MB`（默认 5GB）、`MAX_CHUNKS`（默认 10 万）守卫（请求时读取，支持运行时配置），并在 `uploadChunk` 增加 `index` 范围校验；超限请求在控制器入口即被拒，不写盘。
- **工程地基**：根与 `server/` 加 `.nvmrc`(24) + `engines.node`，锁定 Node 版本以消除 `better-sqlite3` 原生二进制 ABI 漂移导致的服务端子用例失败。

### Integrity
- **F4 下载分片 206/Range 终检**：`downloader.worker.ts` 现要求 `status===206`、解析并校验 `Content-Range`（`crStart===start && crEnd===end`）且 `blob.size===end-start+1`；代理忽略 Range 返回 200 全量或范围错位时，Worker 报错触发重试，不再静默写入损坏分片。
- **F5 合并字节级 md5 终检**：`merger.worker.ts` / `mergeService.ts` 对合并后 Blob 增量计算全量 md5（复用 `spark-md5`），与文件列表 `md5` 比对；不一致即标记失败并保留分片供重试，杜绝"看起来成功"的静默损坏；无 `expectedMd5` 时跳过（向后兼容）。
- 数据流贯通：文件列表 `md5` → `api.client.ts metadata.md5` → `store/index.ts DownloadFile.md5` → `useFileDownloaderController` 透传 `expectedMd5` 进 `MERGE_FILE`。

### Engineering
- **E2 服务端覆盖率门禁**：弃用 `c8`（`node --test` 子进程模型下 V8 覆盖率采集跨运行抖动 43%↔88%，不可靠）；改用 Node 24 原生 `--experimental-test-coverage`，`--test-coverage-include='src/**'`、`--test-coverage-exclude='src/index.js'`（bootstrap 不计入），门槛 **行80 / 分支65 / 函数80**（实测基线 行82.48% / 函数83.94%）。`server` 的 `test` 脚本内嵌该门槛，未达即非零退出；CI `.github/workflows/ci.yml` server job 升 Node 22→24 与 `.nvmrc` 对齐。
- **E3 端到端冒烟**：新增 `server/e2e/smoke.mjs`，用 Node 原生 `fetch`/`FormData` 驱动真实服务端 API（无需 Playwright 浏览器），一条命令跑通"生成随机文件→分片上传→合并→列表→分片 Range 下载（镜像 F4：206 + Content-Range + 字节数校验）→重组→整文件下载交叉校验→md5 比对"，验证全链路不损坏。服务端数据目录经 `SERVER_DATA_DIR` 等 env 隔离到临时目录、`AUTH_MODE=demo`；子进程复用 `process.execPath`（建议 Node 24）。`server` 的 `e2e` 脚本 + `verify`（串联 `test && e2e`）已接 CI。
- **D1 依赖安全升级**：`axios` 1.9.0→1.20.0（清除生产**关键**漏洞 `form-data` 不安全随机边界 + `follow-redirects` 跨域头泄漏）、`express` 4.21.2→4.22.3（清除 `proxy-addr` **关键** IP 伪造 + `qs` 中危 DoS）；`sequelize` 保持 6.x 不变（其传递的 `uuid` 中危只能经 `npm audit fix --force` 降级到 sequelize 3.x 修复，按 D1 决策禁止破坏性降级，故保留为中危残留）。`npm audit fix`（安全、非 `--force`）清除 dev 传递漏洞（ws/picomatch/minimatch/js-yaml/brace-expansion/flatted 等）。结果：根生产依赖 **0 漏洞**，server 生产仅剩 3 个中危（sequelize/uuid，CI 以 `--audit-level=high` 放行）。CI 新增生产依赖审计门禁（client `npm audit --omit=dev`；server `--omit=dev --audit-level=high`）。

### Robustness
- **S11 多段 Range 显式拒绝**：`downloadController.downloadFile` 仅支持单段 `Range`；遇到含逗号的多段请求（`bytes=0-4,6-9`）一律返回标准 `416` + `Content-Range: bytes */size` + `Accept-Ranges: bytes`，避免被误判为单段而返回错误字节区间。非法 Range（起点/终点越界、负数、起点>终点）同样返回标准 `416` + `Content-Range: bytes */size`（此前走 `jsonError` 不带该头，与多段分支行为不一致，已对齐）。新增 `server/tests/range-thumbnail.test.js`（6 用例）覆盖单段 206 + Content-Range + 字节、多段 416、无 Range 整文件 200、非法 Range 416、缩略图 404、非法 id 404；服务端单测 49→55 全绿，覆盖率门禁（行80/分支65/函数80）与 E3 e2e 仍通过。
- **S10 缩略图路由就绪（待 CVE-free thumbnailer）**：新增 `GET /api/file/thumbnail/:file_id`（`downloadController.downloadThumbnail`），与主文件同目录按 `${baseNoExt}_thumb${ext}` 解析缩略图实体，实体缺失返回 `404`、非图片返回 `403`、非法 id 直接 `404`（不扫描目录，沿用 P1-14 口径）。**重要安全取舍**：真实缩略图生成依赖 `sharp`，但 `sharp` 自带 libvips/libheif/librsvg 的高危 CVE（与 D1 刚建立的"生产 0 高/危" + CI `--audit-level=high` 门禁冲突），故**不安装 `sharp`**，路由保持优雅 404 直到出现无 CVE 的 thumbnailer。生成端 `uploadController.buildThumbnailName` 的命名约定已在控制器内对齐，后续接入 thumbnailer 时无需改路由。

## [3.0.0] - 2026-10-24

### Removed
- **移除 `SimpleUploadList` / `SimpleDownloadList` 及 `/simple` 子路径入口**（破坏性变更）：精简外观本就是"预置属性"，现改为在完整组件上直接配置——上传用 `uiMode="simple"`（配 `settingsSource="props"` 避免改动本地设置），下载用 `showStorageStats/showNetworkStatus/showBatchInfo={false}`。迁移示例见 README「简化外观（属性控制）」。原 `SimpleUploadList` 附带的"服务端清单 + 上传弹窗 + 批次清理"依赖业务接口，属 demo 职责，已迁至 `src/demo/SimpleUploadDemo.tsx` 作为纯属性示例。
  - 同步删除 `package.json` 的 `exports["./simple"]`、`src/simple.ts` 与 `vite.lib.config.ts` 的 simple 构建入口。

### Changed
- **库构建不再产出 sourcemap**：dist 体积 1.73MB → 489KB（无 `.map`）；demo 站点构建输出改为 `demo-dist`，与库产物彻底分离。
- 抽取 `shared/formatFileSize` 与 `shared/networkStrategy.resolveNetworkBadgeInfo`，删除上传/下载两侧的重复实现。

### Fixed
- **采样哈希的 size 后缀此前未真正参与哈希**：`spark-md5` 的 `ArrayBuffer.append` 收到字符串会把内部长度算成 `NaN`，现改用 `TextEncoder` 编码后追加。仅影响 `hashMode="sample"` 的哈希值（旧记录不再命中秒传），默认 `full` 模式不变。
- 修复 worker 与测试文件中的严格模式类型错误，`npm run build:demo`（`tsc -b && vite build`）可通过；测试文件不再参与 demo 的类型检查（由 vitest 运行时校验）。

## [2.0.6] - 2026-10-24

### Fixed
- **挂载时清理历史排队僵尸行**：页面刷新后运行时 `fileRef`（File 引用）必然丢失，此前停留在 `QUEUED` / `QUEUED_FOR_UPLOAD` 的行既无法自动上传、又无重试入口，会永远卡在「排队中」（`recoverInterruptedUploadFiles` 的 `interruptedUploadStatuses` 不含 `QUEUED`，不会触碰它们）。现组件挂载时统一将这些历史排队行转为 `ERROR`（`awaitingReselect: true`，progress 归 0，提示「页面已刷新，请重新选择文件后上传」），给出明确指引而非静默卡死。属存储/UI 治理，**公开 API 不变**（`6566515`）

## [2.0.5] - 2026-10-24

### Fixed
- **simple 模式回归纯自动**：移除 `FileUploadActions` 在 simple 模式下的「上传文件」「重试失败文件」两个手动触发按钮（此前 2.0.3 为临时修复 simple 模式排队/失败无入口而加）。simple 模式恢复「选择文件即自动上传/自动重试」的纯自动语义，工具栏仅保留「选择文件」；僵尸行治理交由 2.0.6 的挂载清理机制统一处理（`d9fac9c`）

## [2.0.4] - 2026-10-24

### Added
- **表格列控制**：上传 `ZustandFileUpload` 与下载 `ZustandFileDownload` 新增 `visibleColumns` 属性，可传入列 key 数组控制显示哪些列，并**按数组顺序**排列；缺省（不传）显示全部内置列。上传列 key：`index | fileName | fileSize | chunkCount | status | progress | action`；下载列 key：`fileName | fileSize | chunks | status | progress | action`。类型 `UploadColumnKey` / `DownloadColumnKey` 已从包入口导出。隐藏「操作」列后表格内不再提供暂停/继续/重试/删除等按钮（由消费方自行提供控制）。

## [2.0.3] - 2026-10-24

### Fixed
- **simple 模式补齐失败重试与排队启动入口**（`037c9ca`）：修复 simple 模式下失败文件无法重试、排队文件无法启动的问题。

## [2.0.2] - 2026-10-24

### Added
- **可关闭 debug logger**：新增 `src/shared/debugLogger.ts`，提供 `configureDebug({ silent })` 与 `debugLog/debugWarn/debugError`；库默认 `silent=true`（生产零噪声），消费方 `configureDebug({ silent:false })` 可恢复全部 `[rui]` 日志。随包发布的 12 个库文件 `console.*` 全部替换，`configureDebug` 从 `src/index.ts` 导出，README 新增「调试」小节

### Changed
- **长列表渲染优化**：`src/ui/table.tsx` 行加 `content-visibility:auto` + `contain-intrinsic-size`，超长文件/分片列表屏外行跳过布局与绘制（Firefox/Safari 自动降级）
- **NetworkStatusBadge 拆分瘦身**：约 135 行"网络设置"Modal 抽至独立 `NetworkStatusPanel.tsx`（本地编辑态自管，`onApply` 回交徽章侧），徽章本体聚焦状态点 + 紧凑/tooltip 两种展示 + 三工具栏按钮，导出名与 props 不变
- **上传/下载 Controller 编排/业务策略拆分**：生命周期（worker 会话/刷新调度/卸载销毁）与业务策略（状态聚合/结果判别/文件归一化/消息构造）解耦为 `uploadPolicy`/`useUploaderLifecycle`/`downloadPolicy`/`useDownloaderLifecycle`，原 hook 退化为编排薄壳；**公开签名与返回值 100% 不变**（经 `verify:client` + client-contract 双重校验）
- **列表行 memo + 派生布尔选择器**：列表行组件包 `React.memo`，可见性开关改为直接订阅派生布尔，减少无关重渲染
- **文件列表刷新入口去重**：`api.client` 的 `getFileList` 按参数签名去重在途请求（`pendingFileList` Map，per-instance 隔离），修复并发 TOCTOU 竞态；新增 2 用例（客户端测试总计 130）
- **vitest 提速**：`test:unit` 改 `vitest run --no-isolate`，24 文件 130 用例约 10s（此前 ~18s）
- **修正 `vite.lib.config.ts` 过时注释**：注释声称 worker 用 `new URL(...)` 实际已为 `?worker&inline`

### Fixed
- **server 鉴权默认 fail-closed（拒绝优先）**：`server/src/middleware/auth.js` 的 `createAuthMiddleware` 新增 `requireAuth`（默认 `true`），移除"已挂载却未配置凭据即静默放行"的 fail-open 分支——挂载即要求鉴权，未拿到有效凭据一律 401；`app.js` 在 `REQUIRE_FILE_AUTH=true` 时永远以 `requireAuth:true` 挂载，若开了开关却未配 `FILE_AUTH_TOKEN`/`FILE_AUTH_COOKIE` 则打印 `FATAL` 告警且所有 `/api/file` 请求返回 401，杜绝"本应受保护却 silent open"。默认关闭（无 `REQUIRE_FILE_AUTH`）时行为不变，demo / 集成测试不受影响；新增 `auth-middleware.test.js` + `auth-app.test.js` 回归测试（server 测试 39/39 全绿）。`server/README.md` 新增「鉴权」小节

## [2.0.1] - 2026-10-24

### Added
- **下载组件新增 `showBatchInfo` 属性**：控制"活动中/排队中/已完成/批次进度"整个批次汇总条（含进度条）的显隐，默认 `true`。至此完整版 `ZustandFileDownload` 可通过属性组合（`showStorageStats`/`showNetworkStatus`/`showBatchInfo`/`showProgress`/`autoStart`）直接达到简化版外观；`SimpleDownloadList` 即默认 `showBatchInfo=false` 的薄封装，消费方也可在简化版上设回 `true` 找回汇总条

### Changed
- **内置 UI 套件视觉升级（现代卡片风）**：`src/ui/ui.css` 全面 token 化重写（保留全部 `rui-` 类名，消费方覆盖不受影响）：
  - 设计令牌收敛到 `:root`（品牌蓝 `#2f6bff` 单一主色、三级蓝调阴影、hairline 边框、圆角层级、缓动曲线）；因 Drawer/Modal/message/Tooltip/Popover 等 portal 弹层挂在 `body` 下、不在 `.rui-root` 内，令牌必须定义在 `:root` 才能穿透到弹层
  - 卡片（hairline + 三级阴影层次）、渐变进度条、胶囊状态 pill、等宽数字（tabular-nums，尺寸/进度列天然对齐）、细滚动条；`prefers-reduced-motion` 下全部动效降级
  - `dist/style.css` 体积 15.25 kB → 22.15 kB（gzip 3.41 → 4.59 kB）

### Fixed
- **demo/dev 直引组件导致整页裸奔**：`src/ui/index.ts` 此前未引入 `ui.css`（仅 `src/index.ts` 引入），demo 经 `../../../ui` 直引组件时 `rui-*` 类全部无样式、空态 SVG 撑满容器。现 `src/ui/index.ts` 顶部补 `import "./ui.css"`，样式随组件走；lib 构建下同一文件去重，仍只产出一份 `dist/style.css`
- **portal 弹层衬线字体回退**：Drawer/Modal/message/Tooltip/Popover 挂在 `body` 下丢失 `--rui-font-sans` 字体栈，弹层内数字/文字回退到浏览器衬线默认字体。字体规则现扩展覆盖 `.rui-drawer/.rui-modal/.rui-message-notice/.rui-tooltip/.rui-popover`
- **portal 弹层缺 `box-sizing: border-box`**：`box-sizing` 此前只作用于 `.rui-root *`，Drawer/Modal 等 portal 弹层内全部按浏览器默认 `content-box` 计算——统计抽屉两列 `Col span=12`（50% + 左右 padding 8px）超出 100% 被挤成竖排堆叠。`border-box` 现同步覆盖 `.rui-drawer/.rui-modal/.rui-message-notice/.rui-tooltip/.rui-popover`
- **Switch 文字叠滑块**：`.rui-switch-text` 的左右定位规则错误地挂在 `.rui-switch-checked` 下，未选中态文字无定位直接叠在滑块上（「简洁/详细」开关乱成一团）；且 44px 开关塞 2 个汉字 + 18px 滑块必然重叠。现文字与滑块分居两侧（checked 文字在左/unchecked 在右），带文字时开关自动加宽（44px 默认 / 56px 带文字），`size="small"` 真正生效（28×16 迷你尺寸）
- **InputNumber 忽略 `size="small"`**：单独使用（无 addonAfter）时 size 被丢弃，设置行「延时(秒)」输入框仍是大尺寸。新增 `rui-input-number-sm`（24px 高）
- **Title 透传 style 被覆盖**：`{...rest}` 在内部 `style` 之后展开，传入 `style={{marginTop:24}}` 会整体覆盖内部样式（字号丢失回退 14px、边距丢失标题贴内容）。改为内部默认值与透传 style 合并，并给 Title 默认 `margin: 0 0 12px`
- **存储统计抽屉空态悬空标题**：0 文件时「状态分布」标题仍渲染、下方空白。现无文件时渲染 Empty 空态
- **操作行溢出**：上传操作行（按钮 + 网络状态 + 设置项）在窄容器下溢出产生横向滚动。外层/左右分组均加 `flex-wrap: wrap`

### Added
- **子路径按需引入（真·分包）**：新增 `src/upload.ts` / `src/download.ts` / `src/simple.ts` 三个薄入口，配合 `vite.lib.config.ts` 多入口构建与 `package.json` 的 `exports` 子路径映射：
  - `react-upload-indexeddb/upload` 只引上传链路、`/download` 只引下载链路、`/simple` 引两个简化组件；样式仍为统一 `react-upload-indexeddb/style.css`
  - 实证隔离：`/upload` 入口的 chunk（98 kB）不含下载专属内容（`大文件下载` 串 0 次），下载逻辑只在 `/download` chunk（该串 2 次），即只引上传不会带入下载引擎
  - 全量入口 `.`（index）保留，旧调用 `import "react-upload-indexeddb/dist/style.css"` 仍可用；`sideEffects: ["*.css"]` 维持具名导出 tree-shaking
- **下载侧简化组件 `SimpleDownloadList`**：与既有 `SimpleUploadList` 对齐，作为 `ZustandFileDownload` 的预配置精简版——默认关闭"存储统计""网络状态"两块重 UI，保留文件列表 + 进度 + 下载/暂停/继续/导出/删除核心操作，底层仍是完整分片续传引擎
- **公开导出两个简化组件**：`src/index.ts` 现导出 `SimpleUploadList` / `SimpleDownloadList`（含 `SimpleUploadListProps` / `SimpleServerFile` / `SimpleDownloadListProps` 类型），此前仅为 demo 专属

### Fixed
- **内置 `Modal` 忽略 `open` 导致弹层常驻**：自定义 `Modal` 此前完全忽略 `open` 始终渲染，调用方无法隐藏（"简化模式"上传弹层无法关闭）。`ModalInner` 现尊重 `open`，关闭时不渲染弹层
- **`SimpleUploadList` 三处类型错误**（此前未进入 tsc 程序而隐藏）：`removeUploadFilesByIds` 漏传 `storage`/`fileRegistry` 两参（现取自 `createUploadStorage()`/`createFileRegistry()`，与内部默认上传实例同 DB/store）；`Modal` 误用不支持的 `destroyOnHidden`（改用条件显隐 + `open`）；`Typography.Paragraph` 误用不支持的 `type`（改用 `--rui-text-secondary` 着色）。相应单测断言同步更新为三参
- **`ZustandFileDownload` 的 UI/行为 props 从未生效**：生效优先级为 Store > Context，而下载 store 默认 `showStorageStats/showNetworkStatus: true`、`autoStart: false` 且无人调用对应 setter——消费方传入的 `autoStart`/`showProgress`/`showStorageStats`/`showNetworkStatus` 被 store 默认值永远覆盖（`SimpleDownloadList` 的"简化"因此不生效）。现组件挂载/props 变化时把显式传入的这四项同步进 store；未传的项保持 store 现值，运行时修改不被重置

## [2.0.0] - 2026-10-24

### Added
- **T3.3 状态机收敛 + 暂停/恢复（目标 v2.0.0）**：
  - 收敛共享上传状态机：删除从未被赋值的死状态 `CALCULATING` / `MERGE_ERROR`（共享 `UploadStatus` 枚举、`statusMap`、`StorageStatsDrawer` 渲染、预处理 Worker 内部枚举同步清理），保留 `PAUSED`
  - `isUploadableStatus` 收敛为 `QUEUED | QUEUED_FOR_UPLOAD | PREPARING_UPLOAD | UPLOADING | ERROR`——**`PAUSED` 不再自动续传**，必须由用户点击「继续」显式触发 `resumeUploadFile`，避免与暂停中的 Worker 重复运行
  - 上传 Worker 新增 `pause` / `resume` 消息：`pause` 置分片边界挂起标志并立即回 `paused{uploadedChunks,totalChunks}`；`resume` 解除挂起从断点续传；Bridge 新增 `pauseUploadTask(fileId)` / `resumeUploadTask(fileId): boolean`，`paused` 以销毁该 Worker（不回空闲池）收尾，消除挂起闭包与 `taskPauseState`/`taskStats`/`taskAbortControllers` 残留
  - Controller 新增 `pauseUploadFile` / `resumeUploadFile`：暂停即乐观置 `PAUSED` 并通知 Worker 边界暂停；继续时若 Worker 已释放（刷新/卸载）则复用 `processFileUpload` 重新发起，服务端 `chunkCheckResult` 保证字节级续传（与下载侧 `handlePause`→重跑 `startDownload` 一致的 fallback 语义）
  - UI 在上传中行显示「暂停」、已暂停行显示「继续」（`FileTable` 接线 + `index.tsx` 透传 handler）
- **T3.4 字节级进度与速率（目标 v2.0.0）**：
  - 新增纯函数 `computeUploadProgress({uploadedBytes,totalBytes,elapsedMs})` 产出 `UploadProgressDetail{progress,uploadedBytes,totalBytes,speed,eta}`，含 0 除/越界/完成态保护
  - 上传 Worker 进度消息升级为 `{progress,uploadedBytes,totalBytes,speed,eta,chunkIndex?}`，Bridge 原样透传 detail 对象
  - `onUploadProgress(file, progress:number)` 旧签名保留并标记 `@deprecated`，新增 `onUploadProgressDetail(file, detail)` 携带字节级速率与预计剩余时间
  - store 新增 `speedMap` / `etaMap`，`PercentDisplay` 在 `UPLOADING` 行展示 MB/s 与剩余时间副行
  - 新增 `uploadProgress.test.ts`（8 用例）、`worker/uploadWorker.pause.test.ts`（2 用例）、`uploadWorkerBridge.test.ts` 扩展（5 用例）覆盖上述行为

### Changed
- **T3.1 流式分片 + 采样哈希（Breaking Change，目标 v2.0.0）**：
  - `UploadFile.buffer` 字段移除，新增**运行时** `fileRef: File`（仅当前会话内存，不序列化进 IndexedDB）；文件字节改为上传时由 Worker 经 `fileRef.slice(start,end).arrayBuffer()` 逐分片惰性读取，内存峰值 = `chunkSize × chunkConcurrency`，与文件大小解耦（彻底消除整文件驻留）
  - 新增 `src/components/ZustandFileUpload/services/fileRegistry.ts`：主线程文件引用注册表，上传成功 / 删除 / 清理时联动释放，避免 File 句柄长期驻留
  - 新增 `hashMode` prop（`"full"` 默认全量流式哈希 / `"sample"` 采样哈希：首 4MB + 尾 4MB + 中间 3 采样点 + size），贯通 props → Context → 预处理 Worker → 上传 Worker → 服务端 `mergeChunks`；`sample` 模式下服务端跳过全量 md5 强校验（分片级 md5 校验仍全覆盖）
  - 刷新续传语义变更：页面刷新后需**重新选择同一文件**方可续传，已上传分片由服务端 `chunkCheckResult` 自动跳过（详见 README「v2.0.0 重大变更」）
  - 测试环境 jsdom 缺 `Blob.arrayBuffer`，在 `src/test/setup.ts` 以 `FileReader` 补齐（浏览器原生支持，production 代码不变）
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
