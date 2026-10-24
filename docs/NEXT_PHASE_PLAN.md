# 下一阶段改进规划（v3.x → v4 路线图）

- 制定日期：2026-10-24
- 依据：`docs/code-review-report.md`（全量代码审查，22 项：6 High / 9 Medium / 7 Low）、本次全面测试结果、3.0.0 已完成项复盘
- 目标：把"能否安全上线 + 数据完整性 + 工程可信度"三件事补齐，为 v4 铺路

## 进度（已实现）

> 第一批增量（2026-10-24）：工程地基 + P0 安全基线已落地，服务端测试 42/42 全过（Node 24）。
> 第二批增量（2026-10-24）：P1 端到端完整性（F4 + F5 + S7）已落地，客户端测试 136 → **140** 全过（`verify:client` 全绿）。
> 第三批增量（2026-10-24）：**E2 服务端覆盖率门禁**已落地——改用 Node 24 原生 `--experimental-test-coverage`（c8 在 `node --test` 子进程模型下覆盖率采集不稳定，弃用），门槛 行80 / 分支65 / 函数80（基线 行82.48 / 函数83.94），CI 已接 Node 24。

- [x] **E1** Node 版本锁定：根 + `server/` 加 `.nvmrc`(24) 与 `engines.node`
- [x] **S1** 鉴权默认 `secure`（fail-closed）：`AUTH_MODE` 取代旧 `REQUIRE_FILE_AUTH`，默认挂载、`requireAuth:true`、无凭据即 `401`
- [x] **S4** CORS 默认关闭：仅 `CORS_ORIGIN` 显式白名单（非 `*`）才启用
- [x] **S5** 安全响应头：`disable('x-powered-by')` + `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` / `Cross-Origin-Resource-Policy`
- [x] **S6** 错误脱敏：生产仅返通用文案，堆栈落日志；导出 `errorHandler` 单测
- [x] **S7** `auth.js`：Cookie `decodeURIComponent` try/catch + Bearer `timingSafeEqual` 定长比较 + `OPTIONS` 跳过鉴权
- [x] **S2** 秒传防污染：服务端以真实全量 md5 为权威去重键（杜绝 sample 哈希碰撞污染），合并后强制体积校验（`stat.size === 声明 size`）；full 模式仍校验声明 md5，sample 模式跳过声明比对但仍以真实全量 md5 落库
- [x] **S3** 容量 / 分片数上限（DoS 防护）：`MAX_UPLOAD_SIZE_MB`（默认 5GB）/`MAX_CHUNKS`（默认 10 万）守卫（请求时读取），`index` 范围校验，超限请求在控制器入口被拒（不写盘）
- [x] 服务端测试补 `cors-default.test.js` / `error-handler.test.js` / `upload-security.test.js`；functional 测试改 `AUTH_MODE=demo`；服务端 49/49 全过（Node 24）
- [x] **E2** 服务端覆盖率门禁：弃用 `c8`（在 `node --test` 子进程模型下覆盖率采集不稳定、跨运行 43%↔88% 抖动）；改用 Node 24 原生 `--experimental-test-coverage`，`--test-coverage-include='src/**'`、`--test-coverage-exclude='src/index.js'`（bootstrap 不计入），门槛 **行80 / 分支65 / 函数80**（实测基线 行82.48% / 函数83.94%）；`server/package.json` 的 `test` 脚本内嵌该门槛，未达即非零退出；CI `.github/workflows/ci.yml` server job 升 Node 22→**24** 与 `.nvmrc` 对齐，`npm --prefix server test` 自动卡门槛
- [x] **S7** `auth.js`：Cookie `decodeURIComponent` try/catch + Bearer `timingSafeEqual` 定长比较 + `OPTIONS` 跳过鉴权（与第一批 S7 合并落地）
- [x] **F4** 下载分片 206/Range 终检：`downloader.worker.ts` 要求 `status===206`、正则解析 `Content-Range`（`/^bytes (\d+)-(\d+)\/(?:\d+|\*)$/`）校验 `crStart===start && crEnd===end`、且 `blob.size===end-start+1`；不满足即失败触发重试（新增 `downloadAuth.test.ts` 负例：200 不判成功）
- [x] **F5** 合并阶段字节级 md5 终检：`merger.worker.ts` / `mergeService.ts` 增量计算合并 Blob 全量 md5（复用 `spark-md5`），与列表 `md5` 比对；不一致抛错并保留分片供重试；无 `expectedMd5` 时跳过（向后兼容）。数据流：`list md5` → `api.client.ts metadata.md5` → `store/index.ts DownloadFile.md5` → `useFileDownloaderController` 透传 `expectedMd5` 进 `MERGE_FILE`。新增 `merger.integrity.test.ts`（正确/错误/缺失 md5 三态）
- [x] 客户端测试补 `downloadAuth.test.ts`(F4 负例) / `merger.integrity.test.ts`(F5 三态)；`verify:client` 全绿：**140/140 测试** + lint 0 错误 + lib 构建通过 + client-contract passed
- [x] **E3** e2e 冒烟：新增 `server/e2e/smoke.mjs`（Node 原生 `fetch`/`FormData` 驱动真实服务端 API），自动化"生成随机文件→分片上传→合并→列表→分片 Range 下载（镜像 F4：206+Content-Range+字节数校验）→重组→整文件下载交叉校验→md5 比对"。临时数据目录（`SERVER_DATA_DIR` 等 env 隔离，落 `os.tmpdir`）+ `AUTH_MODE=demo`；子进程复用 `process.execPath`（建议 Node 24 跑）。`server` 的 `e2e` 脚本 + `verify` 串联 `test&&e2e`；CI server job 已接。验证通过：3.15MB（4 片，末片 partial 12345B）round-trip md5 一致
- [x] **D1** 依赖升级：`axios` 1.9.0→1.20.0（清生产**关键** `form-data` 不安全随机边界 + `follow-redirects` 跨域头泄漏）、`express` 4.21.2→4.22.3（清 `proxy-addr` **关键** IP 伪造 + `qs` 中危 DoS）；`sequelize` 保持 6.x（其传递 `uuid` 中危只能靠 `--force` 降至 3.x 修复，D1 明确禁止，故保留）；`npm audit fix`（安全，非 --force）清 dev 传递漏洞（ws/picomatch/minimatch/js-yaml/brace-expansion/flatted 等）。结果：root 生产依赖 **0 漏洞**，server 生产仅剩 3 中危（sequelize/uuid，放行）。CI 加生产依赖审计门禁（client `npm audit --omit=dev`；server `--omit=dev --audit-level=high`）。升级后 verify:client 140/140 + server 49/49+e2e 全过
- [x] **S11** 多段/非法 Range 标准 416 + `Content-Range` 头（此前走 `jsonError` 不带头，已对齐）；新增 `server/tests/range-thumbnail.test.js`（6 用例）。服务端单测 49→**55** 全过
- [x] **S10** 受控缩略图路由 `GET /api/file/thumbnail/:file_id` 就绪（实体缺失 404 / 非图片 403 / 非法 id 404）；**不装 `sharp`**（libvips/libheif/librsvg 高危 CVE 与 D1 门禁冲突），保持优雅 404 待无 CVE thumbnailer
- [x] **F8** 下载重试 off-by-one + 文件级计数重置（统一 3 次重试 / 4 次尝试 + 成功归零）；新增 `downloader.worker.retry.test.ts`（2 用例）。verify:client 140→**142** 全过
- [x] **F1** 本地存储安全封装 `safeStorage`（`try/catch` + `rui:` 命名空间 + 旧 key 回退 + schema 校验 + 旧版裸写兼容）；上传 store 的 4 个偏好 setter 与 `initSettings` 改走 `safeStorage`；新增 `safeStorage.test.ts`（9 用例）+ 扩展 `upload.test.ts`（+2）
- [x] **F2** 下载 store persist 版本化（`version:1` + `migrate` 剥离派生字段）+ `partialize` 收敛为 6 个真实用户偏好；新增 `index.persist.test.ts`（2 用例）。verify:client 142→**154** 全过（lint 0 + lib 构建 + client-contract）

---

## 〇、本次全面测试基线（结论）

| 套件 | 命令 | 结果 | 备注 |
| --- | --- | --- | --- |
| 客户端质量门禁 | `npm run verify:client` | ✅ 全绿 | lint 0 错误 · lib 构建通过 · **154/154 测试** · client-contract passed |
| 服务端集成测试 | `server: npm test`（Node 24） | ✅ **49/49 通过 + 覆盖率门槛** | 用编译 `better-sqlite3` 的 Node 24 运行；原生 `--experimental-test-coverage` 行80/分支65/函数80 卡门槛 |
| 服务端 e2e 冒烟 | `server: npm run e2e`（Node 24） | ✅ **round-trip 通过** | 临时数据目录 + `AUTH_MODE=demo`；随机 3.15MB 分片上传→合并→分片 Range 下载→重组→md5 比对一致 |
| 服务端集成测试 | `server: npm test`（默认 Node 22） | ❌ 12/44（32 失败） | **纯环境问题**：`better-sqlite3` 原生二进制按 Node 24(ABI 137) 编译，当前默认 Node 22(ABI 127) 加载即 `ERR_DLOPEN_FAILED`，所有 DB 依赖用例崩在连接阶段；代码无回归 |

**关键判定**：服务端 32 个失败 100% 源于原生模块 ABI 不匹配，不是逻辑缺陷——同一份代码在 Node 24 下 39/39 全过。`f56354b`（3.0.0 的 server 修复）只动 `downloadController/janitor/list-cache`，与连接机制无关。

### 测试体系当前缺口
1. ~~**无 Node 版本锁定**~~：**已解决（E1）**——根与 `server/` 加 `.nvmrc`(24)+`engines.node`，CI server job 升 Node 24。
2. ~~**服务端无覆盖率门禁**~~：**已解决（E2）**——Node 24 原生 `--experimental-test-coverage`，门槛 行80/分支65/函数80（基线 行82.48/函数83.94），`npm test` 内嵌即卡。
3. ~~**无端到端冒烟**~~：**已解决（E3）**——`server/e2e/smoke.mjs` 一条命令跑通"上传→合并→列表→分片下载→重组→md5 比对"，CI 已接入。

---

## 一、环境 / 工程化（最高优先，阻塞 CI 可信度）

| 项 | 内容 | 验收标准 |
| --- | --- | --- |
| E1 | **锁定 Node 版本**（✅ 已完成）：根与 `server/` 加 `.nvmrc`(24) + `engines.node`；CI server job 升 Node 24 | 任一 Node 下 `npm test` 均 49/49，CI 不再出现 ABI 失败 |
| E2 | **服务端覆盖率门禁**（✅ 已完成）：改用 Node 24 原生 `--experimental-test-coverage`（c8 在 `node --test` 子进程下采集不稳，弃用），门槛 行80/分支65/函数80（基线 行82.48/函数83.94） | CI 门禁含 server coverage，`npm test` 未达门槛即非零退出 |
| E3 | **e2e 冒烟**（✅ 已完成）：`server/e2e/smoke.mjs`（Node 原生 fetch/FormData 驱动真实服务端 API，免 Playwright 浏览器依赖），跑通"生成文件→分片上传→合并→列表→分片 Range 下载→重组→整文件交叉校验→md5 比对" | 一条命令验证全链路不损坏，CI 接入 |

---

## 二、安全加固 P0（决定能否安全公网暴露）

> 来源：code-review-report §三/§四，编号沿用审查报告。

| 编号 | 问题 | 改造点 | 验收标准 |
| --- | --- | --- | --- |
| S1 | 文件接口默认无鉴权（默认即公开） | `app.js` 改为 `AUTH_MODE=demo｜secure`，**默认 `secure`（fail-closed）**；移除"默认不挂载"分支；README 把鉴权列为生产必需 | 不设 `AUTH_MODE=demo` 时，所有 `/api/file/*` 未经鉴权一律 401 |
| S4 | CORS 默认反射任意 Origin | `app.js` 默认不开启 CORS；`CORS_ORIGIN` 必须显式白名单；启动校验 | 无 `CORS_ORIGIN` 时不返回 `Access-Control-Allow-Origin` |
| S6 | 错误响应泄漏内部信息 | 全局错误处理器生产只返通用文案，堆栈/路径落服务端日志 | 500 响应不含 SQL/路径原文 |
| S2 | 完整性校验可被绕过（秒传污染） | `hash_mode` 服务端强制或默认 `full`；落库前 `stat.size === Number(size)`；秒传命中后可选抽样/全量复核 | `sample` 模式无法跳过终检；污染 md5 不会被静默命中 |
| S3 | 上传缺容量/分片上限（磁盘耗尽 DoS） | 新增 `MAX_UPLOAD_SIZE_MB`；`total`/`index` 上界（`index<total`）；单 `file_id` 累计分片数/字节配额；结合 `Content-Length` 前置拦截 | 超限请求在控制器入口被拒，不写盘 |
| D1 | 依赖升级（✅ 已完成）：`axios` 1.9.0→**1.20.0**（清掉生产关键漏洞 `form-data` 不安全随机 + `follow-redirects` 头泄漏）、`express` 4.21.2→**4.22.3**（清 `proxy-addr` 关键 IP 伪造 + `qs` 中危）；`sequelize` **保持 6.x 不动**（其传递 `uuid` 中危只能靠 `--force` 降到 3.x 修复，D1 明确禁止）；`npm audit fix`（安全，非 --force）清掉 dev 传递漏洞（ws/picomatch/minimatch/js-yaml 等） | CI 加生产依赖审计门禁（`--omit=dev`，server 用 `--audit-level=high` 放行 sequelize/uuid 中危残留）；升级后 140/140 + 49/49 + e2e 全过 |

---

## 三、数据完整性 P1

| 编号 | 问题 | 改造点 | 验收标准 |
| --- | --- | --- | --- |
| F4 | 下载分片不校验 206/Content-Range，代理忽略 Range 会静默产出损坏文件 | `downloader.worker.ts` 要求 `status===206`、解析并校验 `Content-Range` 与期望 `start/end` 一致、`blob.size===end-start+1`；不满足即失败重试 | 返回 200 全量/范围错位时，Worker 报错重试而非写入损坏分片 |
| F5 | 合并阶段无最终完整性校验 | `merger.worker.ts`/`mergeService.ts` 对合并后 Blob 增量计算 md5（复用 `spark-md5`），与列表 `md5` 比对；不一致标记失败并保留分片供重试 | 分片被截断/缓存替换/服务端内容变更时，用户拿到失败提示而非损坏文件 |
| S7 | Cookie 解析可抛异常 + Token 明文比较 | `auth.js` `decodeURIComponent` 包 try/catch（畸形视为无 cookie）；`bearerTokens` 比较改 `crypto.timingSafeEqual` + 定长 | 畸形 cookie 不再 500；令牌比较抗时序 |

---

## 四、健壮性与体验 P2

| 编号 | 问题 | 改造点 | 验收标准 |
| --- | --- | --- | --- |
| F1 | localStorage 读取无异常保护、key 无命名空间 | 集中封装 `safeStorage`（try/catch + schema 校验 + 版本号），key 加 `rui:` 前缀；上传 store 的偏好 setter 与 `initSettings` 全部经 `safeStorage`；兼容早期裸写原生字符串 | 被污染/半写入数据不再让 store 初始化抛错；多实例不互相覆盖 ✅ 已完成 |
| F2 | Zustand persist 无版本迁移，持久化了派生字段 | `version: 1` + `migrate`（v0 数据剥离派生字段只留偏好白名单）；`partialize` 只持久化真实用户偏好（`displayMode`/`show*`/`maxRetries`） | 升级后旧结构不覆盖新的网络自适应结果 ✅ 已完成 |
| F3 | Worker 对任意 URL 携带鉴权头（SSRF/泄漏风险） | 下载 URL 做同源/白名单校验，非白名单目标剥离鉴权头 | token 不会发往任意域名 |
| F6 | 无 ErrorBoundary，懒加载失败整页白屏 | 外层加 `ErrorBoundary` + "刷新/重载资源"兜底 | 旧 chunk 404/网络抖动不再整页白屏 |
| S5 | 缺安全响应头与指纹收敛 | 引入 `helmet()`、`app.disable('x-powered-by')`、补自定义 404 | 响应带标准安全头 |
| S10 | 缩略图 URL 无对应静态路由（功能缺陷，必然 404） | 新增受控缩略图路由（带鉴权、`Content-Disposition: inline`，仅图片）；真实生成待无 CVE thumbnailer（**不装 sharp**，因其 libvips/libheif/librsvg 高危 CVE 与 D1 门禁冲突） | 路由已就绪：实体缺失 404、非图片 403、非法 id 404 ✅ 已完成 |
| S11 | Range 解析不完整（多段被误判单段） | 只支持单段并显式拒绝多段，补标准 `Content-Range: bytes */size` 响应头；非法 Range（越界/负数/起点>终点）同样返回标准 416 + 该头（此前走 jsonError 不带头，已对齐） | 多段 Range / 非法 Range 均返回 416 且头正确 ✅ 已完成 |
| F7 | 调试日志无上限，生产仍 `console.log` | `useDebugLogger` 限长环形（如 500 条）；生产关闭 `console.log` | 长会话内存不再持续上涨 |
| F8 | 分片重试 off-by-one、文件级重试不重置 | 文件级 `>=` 改 `>`；分片级 `> MAX` 改 `> MAX+1` 并重排 requeue/`allChunksExceeded` 为 `MAX+1` 对齐：**MAX_RETRY_ATTEMPTS=3 现语义为 3 次重试 / 4 次尝试**；批次全部成功后 `retryAttempts` 归零（仅连续失败才累加） | 允许次数准确；分片前 3 次偶发失败、第 4 次成功 → 整文件 COMPLETE（修复前于第 3 次后误中止）✅ 已完成 |
| F9 | 入口 HTML 无 CSP 等安全头 | README 提示宿主设置 CSP/`nosniff`/`frame-ancestors`，给出与 Worker(`worker-src blob:`)、内联样式兼容的示例 | 文档含可复制策略 |
| P1 | 分片批次间固定等待拖慢吞吐 | 退避仅在有失败/限速信号时触发 | 大文件多批次吞吐不再被固定 delay 拖累 |

> React 性能专项（code-review-report §六）：**无明显性能债务**，暂不单列任务；仅 F1/F2 顺带治理本地存储，文件表虚拟滚动维持现状（受 `maxFiles`/分页约束，当前规模可接受）。

---

## 五、执行顺序建议

1. **E1 → E2 → E3**（工程地基）：先把 Node 版本锁死、补 server coverage、加 e2e 冒烟，让后续改动有可信护栏。
2. **S1 → S4 → S6**（P0 公网安全基线）：决定"能否暴露到公网"。
3. **S2 → S3 → D1**（P0 数据防污染 + DoS + 依赖）：上线前必做。
4. **F4 → F5 → S7**（P1 端到端完整性）：消除"看起来成功"的静默损坏。
5. **F1~F9 / S5 / S10 / S11 / P1**（P2 健壮性）：按优先级穿插，不阻塞发版。

---

## 六、与历史清单的关系

- `docs/archive/IMPLEMENTATION_CHECKLIST.md`（v2 的 9 项，含 #8 server fail-closed）已 100% 完成并随 2.0.2/2.0.6 发布。
- 本规划是 **3.0.0 之后的新路线图**，聚焦 code-review-report 的 22 项剩余问题 + 测试工程化缺口。
- **已完成的前置项**：server 鉴权中间件已 fail-closed（#8）——本规划的 S1 在其之上补"默认挂载/白名单"，而非重做。
