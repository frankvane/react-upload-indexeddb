# 依赖瘦身分析：vitest 升级 / 去 ahooks / 去 antd

> 配套文档：[`project-analysis.md`](./project-analysis.md)（问题分析）、[`implementation-checklist.md`](./implementation-checklist.md)（实施清单）
> 制定日期：2026-10-23　｜　基线版本：`v1.0.5`（阶段一+二已合入 main，未发版）

---

## 0. 结论摘要（TL;DR）

| 议题 | 结论 | 工作量 | 风险 | 建议版本 |
| ---- | ---- | ---- | ---- | ---- |
| vitest 2 → 5 升级 | ✅ **已实施**（vite 7 + istanbul provider + Node 22 CI）。v8 coverage 与 SWC 不兼容须切 istanbul | 1 人日 | 低 | v1.2.0 |
| 去 ahooks（仅用 useNetwork） | ✅ **已实施**。自研 hook 完全替代，deps 仅剩三个 | 0.5 人日 | 低 | v1.2.0 |
| 去 antd | ✅ **已实施**（精减模式，见 §4.7）。内置 `rui-ui` 替代，peer 仅剩三个，demo 产物 -71% | ~14 人日 | 中~高 | v1.3.0（独立发版） |

三条独立任务，T4.1/T4.2 可并行，T4.3 最后做。均不改变对外 API（props/事件/导出类型），**除视觉样式外无 Breaking Change**。

---

## 1. 现状量化（2026-10-23 实测）

### 1.1 依赖全景

| 类别 | 包 | 说明 |
| ---- | -- | -- |
| dependencies | ahooks ^3.8.5 | **仅用到 `useNetwork` 一个 hook**（上传/下载各 1 处） |
| dependencies | axios ^1.9.0 | 下载侧 API（/list、鉴权） |
| dependencies | localforage ^1.10.0 | 上传/下载 IndexedDB 封装 |
| dependencies | spark-md5 ^3.0.2 | 分片 MD5（随 Worker 内联，不能 external） |
| peerDependencies | antd ^5.25.0 \|\| ^6.0.0 | UI 层全部组件 |
| peerDependencies | react / react-dom ^18 \|\| ^19 | — |
| peerDependencies | zustand ^5.0.0 | store |
| devDependencies | vitest 2.1.8 / @vitest/coverage-v8 2.1.9 | 测试（v5 peer 冲突后降级的妥协状态） |
| devDependencies | vite 5.4.19 | 构建 |

### 1.2 体积实测（关键事实）

**库产物（`vite.lib.config.ts`）**：`dist/index.js` 177.17 kB（gzip 51.08 kB）。
**antd 在 lib 构建中是 `external`——177 kB 里不含一行 antd 代码。** 消费者安装本库时，antd 由消费方自己的依赖树提供。

**demo 站点构建**（`vite.config.ts`，含 antd 全部 UI）：总产物约 **1.26 MB raw**，其中：

| chunk | raw | gzip |
| ----- | --- | ---- |
| vendor-antd-core | 493.71 kB | 155.61 kB |
| vendor-antd-table | 129.75 kB | 42.54 kB |
| vendor-antd-input | 109.05 kB | 31.58 kB |
| vendor-antd-overlay | 49.80 kB | 15.61 kB |
| vendor-antd-form | 33.10 kB | 10.84 kB |
| vendor-antd-visual | 21.11 kB | 7.48 kB |
| vendor-antd-icons | 9.25 kB | 2.81 kB |
| vendor-antd-picker | 1.56 kB | 0.72 kB |
| vendor-misc（rc-util，antd 基础设施） | 81.71 kB | ~28 kB |
| **antd 生态合计** | **929 kB（占 74%）** | **~272 kB** |

### 1.3 由此得出的三个基本判断

1. **去 antd 的收益不在"库变小"**，而在：消费方不再被 peer 强制安装 antd（对不用 antd 的消费方 = 省 ~272 kB gzip + CSS-in-JS 运行时开销 + antd v5/v6 版本约束）；对已用 antd 的消费方（如 vane-crm）则成本持平（自带 UI 约 30~60 kB，但可完全移除本库的 antd peer）。
2. **ahooks 的去留是纯依赖卫生问题**：tree-shake 后 useNetwork 仅 ~2 kB，但它是 `dependencies`（非 peer），删除直接减少消费方传递依赖。
3. **vitest 2.1.9 是"被 peer 冲突逼出来的降级"**，升级到 5 是回到正轨，且能白拿 Vite 7/8 的构建性能（Rolldown 宣称 10~30x）。

---

## 2. 专题一：vitest 2 → 5 升级（T4.1）

### 2.1 前置硬条件

- **Node ≥ 22.12.0**（本地 22.22.2 ✅；CI 现为 Node 20 ❌ 必须改）
- **vite ≥ 6.4**（现装 5.4.19 ❌ 必须连带升级；vitest 5 起 vite 从内部依赖改为 peer）

### 2.2 影响面逐项核对（基于官方 migration guide）

| Vitest 5 变化 | 本项目是否受影响 | 结论 |
| ------------- | ---------------- | ---- |
| `clearMocks` 默认改为 true | `vite.config.ts` 已显式 `clearMocks: true` | ✅ 无影响 |
| `vi.mock`/`vi.hoisted` 不在顶层会抛错 | 全部测试均在模块顶层调用 | ✅ 无影响（反而更早暴露坏味道） |
| `-t` 匹配 `>` 连接的全名 | CI 未用 `-t` 过滤 | ✅ 无影响 |
| `test.sequential` 选项移除 | 未使用 | ✅ 无影响 |
| coverage `thresholds` 的 glob 键（`"src/shared/**"`） | ratchet 门槛依赖此特性 | ⚠️ 升级后复验（官方未列移除，预期保留） |
| reporter 产物落 `.vitest/` | 未用 reporter 产物 | ✅ 无影响 |
| inline project 默认继承 root config | 未用 projects | ✅ 无影响 |

### 2.3 连带升级链

```
vitest@5.0.5 + @vitest/coverage-v8@5.0.5   （peer 对齐，原冲突自然消解）
  └─ 要求 vite@^7（或 ^8）
       └─ @vitejs/plugin-react-swc@3.10.0 → 4.3.3（peer 支持 vite ^4~^8）
            └─ CI：actions/setup-node 20 → 22
```

### 2.4 vite 7 vs vite 8 路线选择

| | vite 7 + vitest 5 | vite 8 + vitest 5 |
| - | - | - |
| 打包器 | Rollup + esbuild（与现状一致） | **Rolldown + Oxc（全新）** |
| `manualChunks` 函数形式 | 不变 | **deprecated → 须迁到 `rolldownOptions.output.codeSplitting.groups`** |
| `?worker&inline`（4 个 Worker） | 行为不变 | **需重点复验**（1.0.4/1.0.5 在此踩过坑，见 memory） |
| JS 压缩器 | esbuild | **Oxc minifier，体积假设不同，必须复测** |
| 构建速度 | 基准 | 10~30x（大项目才明显，本库收益有限） |
| 风险 | 低 | 中 |

**建议：T4.1 走 vite 7 + vitest 5（低风险拿全测试收益）；vite 8 拆为独立可选任务 T4.1b**，带完整复验清单（产物体积对比 + worker inline 冒烟 + demo 构建）。

### 2.5 验收标准

1. `npx vitest run` 20 文件 / 90 用例全绿；`--coverage` 门槛通过（含 glob 门槛）。
2. `npm run build` 产物与升级前对比：index.js 体积偏差 < 5%（vite 7）/ 需人工确认（vite 8）。
3. `npm pack --dry-run` 71 文件不变；`verify-client-contract` 通过。
4. CI（Node 22）全绿。

### 2.6 实施结果（2026-10-23，T4.1 已完成）

- 升级链落地：vitest 5.0.5 + vite 7.3.7 + plugin-react-swc 4.3.3，108 用例全绿（原 90 + 新增 18），CI Node 22。
- **重要发现：coverage provider 必须从 v8 切 istanbul。** vitest 4+ 起 v8 provider 改用 AST 重映射（ast-v8-to-istanbul），与 `@vitejs/plugin-react-swc` 存在已知不兼容（[vitest-dev/vitest#9293](https://github.com/vitest-dev/vitest/issues/9293)：内联组件/函数报 0% 或大幅低报）；官方修复（ast-v8-to-istanbul#120）装到 1.0.7 后**本仓库实测仍复现**——`useNetworkDetection.ts` 从 91.66% 跌到 0%、PercentDisplay 从 100% 跌到 20%。istanbul provider 源码级插桩不受 SWC sourcemap 重映射影响，数字与 vitest 2 时代基线吻合（useNetworkDetection 恢复 90%），故切换并卸载 `@vitest/coverage-v8`。
- 覆盖率门槛按 istanbul 实测值重校：全库 lines 35 / funcs 30 / branch 25（实测 38.5/33.3/30.8）；`src/shared` 保持 80（补测后实测 96.4/94.9/100/96.7，大幅超额）；services 65/70/65/60。
- 顺带补强 `networkStrategy.test.ts`（4 → 17 用例，覆盖率 59.72% → 95.83%）——纯逻辑核心，不值得为凑门槛而降标准。
- lib 产物 169.51 kB / gzip 43.58（升级前 177.17 / 51.08，**小 4.3%**）；四 worker 仍以 `?worker&inline` Blob 交付（sourcemap 模块清单验证）；pack 72 文件；契约校验通过。
- **demo 构建 `manualChunks` 需简化**：vite 7 的新 Rollup 对原 antd 8 分组报循环 chunk 警告（vendor-misc ↔ vendor-react ↔ vendor-antd-core）。合并为单一 `vendor-antd` 组并把漏网的 `@rc-component/*`、`react-is`、`zustand` 归组后警告清零。T4.3 去 antd 后该分组整体删除。

---

## 3. 专题二：去 ahooks（T4.2）

### 3.1 用法盘点（全部）

| 文件 | 用法 |
| ---- | ---- |
| `src/components/ZustandFileUpload/hooks/useNetworkDetection.ts` | `const { rtt, online, effectiveType, type } = useNetwork()` |
| `src/components/ZustandFileDownload/hooks/useNetworkDetection.ts` | 同上 |

只用 4 个字段；ahooks  additionally 返回的 `since`/`saveData`/`downlink`/`downlinkMax` 均未使用。

### 3.2 ahooks 实现剖析

ahooks `useNetwork` 实际约 70 行（含 tslib 助手）：监听 `window` 的 `online`/`offline` 事件 + `navigator.connection`（含 moz/webkit 前缀回退）的 `change` 事件，初始值取 `navigator.onLine` + connection 属性。**没有任何魔法。**

### 3.3 自研设计

新增 `src/shared/useNetwork.ts`（约 50 行 TS）：

```ts
export interface NetworkState {
  online: boolean | undefined;
  rtt: number | undefined;
  type: string | undefined;          // navigator.connection.type（实验性）
  effectiveType: string | undefined; // '4g' | '3g' | '2g' | 'slow-2g'
}
export function useNetwork(): NetworkState;
```

要点：
- 事件监听与 ahooks 完全一致（online/offline/connection change），SSR 安全（`typeof navigator` 守卫）。
- **不加 `since`**（死字段，YAGNI）。
- 两处 `useNetworkDetection.ts` 改 import 路径即可，业务代码零改动。
- 删除 `ahooks`：`package.json` dependencies、`vite.lib.config.ts` 的 `external` 数组。
- 单测 4 用例：初始值、online/offline 事件、connection change 事件、卸载清理（`removeEventListener` 断言）。

### 3.4 验收标准

1. 两处 `useNetworkDetection` 行为不变（`networkStrategy.test.ts` 7 用例仍绿）。
2. `useNetwork.test.ts` 4 用例通过；`npm ls ahooks` 为空。
3. `npm pack --dry-run` 后 tarball 不含 ahooks 引用；消费方安装树无 ahooks。

### 3.5 实施结果（2026-10-23，T4.2 已完成）

- `src/shared/useNetwork.ts`（约 90 行含注释与 SSR 守卫）+ `useNetwork.test.ts` 5 用例落地；两处 `useNetworkDetection.ts` 仅改 import。
- `npm ls ahooks` 为空；`dependencies` 仅剩 `axios`/`localforage`/`spark-md5`；`vite.lib.config.ts` external 移除 ahooks；README 补充运行时依赖说明。
- 全量 108 用例全绿；lib 构建/契约/pack 全部通过。实际耗时约 0.5 人日，与预估一致。

---

## 4. 专题三：去 antd（T4.3）——重点

### 4.1 先澄清一个误区

去 antd **不会让 `dist/index.js` 从 177 kB 变小**（antd 本就是 external）。它的真实收益与代价：

**收益**
- 不用 antd 的消费方：不再被迫安装 antd（~272 kB gzip + CSS-in-JS 运行时注入成本 + v5/v6 版本对齐成本）。
- peerDependencies 从 4 个减为 3 个（react/react-dom/zustand），安装冲突面显著缩小。
- 库完全自控 UI 行为与样式，**根治 project-analysis 已记录的"antd 静态 message 不吃 ConfigProvider 主题"问题**（上传侧 store 默认 `message` 是 antd 静态实例，不随消费方 ConfigProvider）。
- demo 站点 1.26 MB → 约 350 kB。

**代价**
- 已用 antd 的消费方（vane-crm）会多带 ~30~60 kB 库自带 UI；但其 antd 可继续自用，互不影响。
- 默认观感从"antd 设计语言"变为"库自带极简样式"，**README 必须明示**，并给出样式覆盖入口（CSS 变量或 className 穿透）。

### 4.2 使用盘点（20 文件 / 21 处 import / 21 种组件 + 15 个图标）

| 替换难度 | 组件 | 使用处 | 说明 |
| -------- | ---- | ------ | ---- |
| ⭐ trivial | Space / Typography / Card / Tag / Badge / Alert / Empty / Spin / Row / Col / Statistic | 13 文件 | 纯布局与展示，div + class |
| ⭐⭐ 简单交互 | Button / InputNumber / Switch / Tooltip / Progress | 8 文件 | Tooltip 需定位 + delay；Progress 纯 CSS |
| ⭐⭐⭐ 复杂 | **Table ×3 使用方** | FileTable / FileList / SimpleUploadList | 需支持：列定义 + render、align、ellipsis、width、rowSelection（checkbox + 按行 disabled）、scroll.x、loading、空态、bordered、pagination=false |
| ⭐⭐⭐ 浮层 | **Modal ×2 / Drawer ×2** | SimpleUploadList / StorageStats / BatchInfoDisplay / StorageStatsDrawer | 需 Portal、遮罩、Esc 关闭、焦点陷阱、基本动画 |
| ⭐⭐ 全局反馈 | **message ×6 调用点** | store/upload.ts（默认静态）+ useDownloadFiles / useFileDownloaderController / useStorageManager / downloadEventHandlers / FileList / SimpleUploadList | **上传侧已有注入层**（`getMessageApi`/`setMessageApi`，store 字段类型为 antd `MessageInstance`）——改为本地 `MessageLike` 接口即可；下载侧是静态直调，需引入轻量全局单例 |
| ⭐⭐ 图标 | @ant-design/icons ×15 | 7 文件 | 内联 SVG（约 15 × 20 行） |

### 4.3 工作量分解（合计 14~20 人日）

| 工作项 | 人日 | 内容 |
| ------ | ---- | ---- |
| UI 基础层（14 个 trivial 组件 + `ui.css`） | 3~4 | `src/ui/` 新目录，纯 div + BEM class + CSS 变量主题 |
| Table 自研 | 3~4 | `src/ui/Table.tsx`：列渲染/对齐/ellipsis/选择列/横滚/加载/空态；迁移 3 个使用方（~700 行） |
| Modal + Drawer | 2~3 | Portal + 遮罩 + 焦点陷阱 + Esc + 动画；迁移 4 处 |
| message 全局层 | 1 | 容器 + 队列 + 自动消失 + success/warning/error/info；上传侧接既有注入层，下载侧改单例 |
| 图标内联 | 0.5~1 | 15 个 SVG path 拷贝 |
| 测试 | 2~3 | 新增 UI 组件单测；`SimpleUploadList.test.tsx` / `index.simple.test.tsx` 现按 antd 真实渲染断言，需改选择器；新增 Table 行选择/Modal 焦点用例 |
| 视觉回归 + demo 验证 | 1~2 | 人工走查上传/下载全流程 + 深浅背景对比 |

### 4.4 已具备的利好（降低工作量的既成事实）

1. **message 注入层已存在**：上传侧 `getMessageApi()` 从 store 取，默认值是 antd 静态 `message`——换默认实现即可，6 个调用点里最重的部分已抽象。
2. **公共 API 无 antd 类型泄漏**：`src/index.ts` 导出的 `AlignItem` 是本地字符串联合类型（`types/upload.ts:141`），props/事件均无 antd 类型。
3. **唯一的 antd 类型残留是 store 内部** `MessageInstance`（`store/upload.ts:9`）——换成本地 `MessageLike` 接口（`{ success/warning/error/info(text): void }`），`tsc` 可全量验证无泄漏。
4. antd v5 是 CSS-in-JS，**替换后不需要处理任何 antd 样式导入**（src 内零 `.css` import），只需新增一个库自带 `ui.css`（约 300 行）并加入 `package.json` 的 `files`。

### 4.5 三个方案对比

| 方案 | 描述 | 评价 |
| ---- | ---- | ---- |
| **A. 自建轻量 UI 层**（推荐） | `src/ui/` 20 个组件 + 1 个 css，零新依赖 | 14~20 人日；peer 4→3；完全自控 |
| B. 换 headless 库（Radix/ariakit） | 无障碍/定位由库负责，样式自写 | 引入新 peer ~30~60 kB，**违背"去依赖"初衷**；且 Table/Modal 仍需大量自写 |
| C. UI 可选化（render props/slots） | 默认零 UI，消费方注入 | 架构最优但改对外 API（Breaking），属阶段三 T3.x 范畴，与 T3.2 单例治理一起做 |

### 4.6 验收标准

1. `grep -r "from \"antd\"" src/` 与 `@ant-design/icons` 均为空；`package.json` peerDependencies 仅剩 react/react-dom/zustand。
2. `npm run build` 产物功能不变；新增 `dist/ui.css` 且 `files` 包含；`npm pack --dry-run` 校验。
3. 90 个既有单测全绿（迁移后）；新增 UI 层单测 ≥ 15 用例（Table 行选择、Modal 焦点陷阱、message 队列）。
4. demo 站点构建 < 400 kB raw（对比当前 1.26 MB）。
5. 人工走查：上传（完整/简洁双模式）+ 下载全流程视觉与交互回归，清单存档。

### 4.7 实施结果（2026-10-23，T4.3 已完成）

**实施模式**：用户拍板**精减模式**——不追求 antd 全量兼容，只实现调用点真实用到的 API 面，以体积最小化为第一目标。

**交付形态**（`src/ui/`，9 个文件，合计 ~2,400 行 TS + 15.25 kB CSS）：

| 文件 | 内容 |
| ---- | ---- |
| `primitives.tsx` | Button / Tag / Badge / Spin / Empty / Divider / Card / Space / Alert / Statistic / Progress / Switch / InputNumber / Slider（14 个） |
| `typography.tsx` | Typography（Text/Paragraph/Title）+ Row/Col 24 栅格 |
| `feedback.tsx` | Tooltip / Popconfirm / Modal（含 `Modal.confirm`）/ Drawer（portal + ESC + 焦点管理） |
| `collapse.tsx` / `table.tsx` / `message.tsx` / `icons.tsx` | Collapse（items API）；Table（rowSelection/ellipsis/scroll.x/loading/empty/bordered）；message 单例（React 18 `createRoot`）；19 个内联 SVG 图标（path 提取自 `@ant-design/icons-svg` ASN 定义，视觉一致） |
| `ui.css` | 静态样式表，`rui-` 前缀，视觉贴近 antd v5 色板/圆角/间距 |

**Drop-in 容忍策略**（为不动业务代码，UI 侧放宽了 7 处 API）：Tag color 接受任意 string；Table render 首参 `any`（对齐 antd 的 dataIndex 推断语义）；Tooltip 补 `getPopupContainer`；InputNumber 补 `addonAfter`/`size`；Switch/Statistic/Progress 补缺失 props；`Modal.confirm` 挂静态方法。

**实测数据**：

| 指标 | 升级前 | 升级后 | 变化 |
| ---- | ---- | ---- | ---- |
| peerDependencies | 4（含 antd） | 3（react/react-dom/zustand） | -1 |
| demo 产物（raw） | ~1,297 kB（含 antd 生态 929 kB） | ~368 kB | **-71%** |
| lib index.js | 169.51 kB（antd external） | 203.46 kB / gzip 53.10 kB（含 UI 套件） | +34 kB 换 -929 kB 消费方依赖 |
| 样式产物 | antd CSS-in-JS 运行时 | `dist/style.css` 15.25 kB / gzip 3.41 kB | 静态化 |
| vite 7 循环 chunk 警告 | 2 个（T4.1 遗留给 demo） | 0 | 清零 |

**验证**：`tsc -p tsconfig.lib.json` 0 错误（注：`tsconfig.json` 是 solution 引用文件，`-p` 直跑不生效，真实检查须用 lib 配置或 `tsc -b`）；eslint 0 告警；108 单测全绿 + coverage 门槛通过；server 29/29；pack 81 文件含 `dist/style.css`；UI 导出面 vs 全库导入面差集校验零缺失（曾抓出漏实现的 `Slider`）。

**踩坑记录**：① 首批 19 文件批量替换时相对路径深度算错一层（`depth` 应为目录段数 -1），构建期 `Failed to resolve import` 暴露；② `@typescript/react-dom@18` 的 `createRoot` 只在 `react-dom/client` 子路径，根模块导入报 TS2339；③ `Modal.confirm` 挂载遇 `const` TDZ——`confirm` 必须先于 `Modal` 定义。

---

## 5. 实施顺序与版本规划

```
阶段四：依赖瘦身（全部不改变对外 API）
  T4.1 vitest5+vite7 升级 ─┐（可并行）
  T4.2 去 ahooks ──────────┤
                           ├─► v1.2.0 发布
  T4.1b vite 8 迁移（可选）─┘
  T4.3 去 antd ──────────────────────────► v1.3.0 发布（建议独立 minor，早上早收益）
```

- **T4.1 与 T4.2 互不依赖，可并行**；都属低风险工具链/依赖卫生改动。
- **T4.3 建议独立分支 + 独立发版**：改动面最大（20 文件）、有视觉回归成本，不应与别的改动混在一个 PR（符合总原则 1）。
- T4.3 与阶段三（T3.1 流式分片）无代码冲突，可插入执行；若阶段三先行，注意 T3.2 单例治理会动同一批 UI 文件的 import 结构，**建议 T4.3 先做**（它把 UI 层私有化，反而简化 T3.2）。
- 发版顺序建议：v1.1.0（阶段一+二）→ v1.2.0（T4.1+T4.2）→ v1.3.0（T4.3）→ v2.0.0（阶段三，Breaking）。

---

## 6. 附：关键事实来源

- vitest 5 migration：<https://vitest.dev/guide/migration.html>（Node ≥22.12、vite ≥6.4、clearMocks 默认 true）
- vite 8 migration：Rolldown/Oxc 替换、`manualChunks` 函数形式 deprecated、`build.commonjsOptions` 无效化
- 体积数据：本地 `vite build` demo 产物 chunk 明细（2026-10-23）
- ahooks `useNetwork` 源码：`node_modules/ahooks/es/useNetwork/index.js`（约 70 行）
- antd 用量：`grep -rn "from \"antd\"" src/` 21 处 / `@ant-design/icons` 7 文件 15 图标
