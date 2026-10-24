# 文档索引

> 项目主入口：[../README.md](../README.md)（安装、快速开始、API 概览、Changelog）

## 一、现行文档（随代码同步维护）

| 文档                                               | 职责                                                 | 不负责                       |
| -------------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| [architecture.md](./architecture.md)               | 模块关系、上传/下载链路、状态机、自动策略闭环        | 逐字段 API、组件接入细节     |
| [components.md](./components.md)                   | 组件 Props、默认值、回调、接入示例（含 v3 简化外观） | 架构推演、接口字段全量契约   |
| [server-api-contract.md](./server-api-contract.md) | `/api/file/*` 请求/响应结构、错误约定                | UI 交互流程                  |
| [demo-script.md](./demo-script.md)                 | 演示与验收步骤、异常排查、记录模板                   | 组件参数详解、架构原理深挖   |
| [interview.md](./interview.md)                     | 面试题库与项目亮点表达、追问准备                     | 运行手册、字段级契约         |
| [code-review-report.md](./code-review-report.md)   | 2026-10-24 全量代码审查结论（基线 v2.0.6）           | 现行架构说明，超出日期即失效 |

建议阅读顺序：

1. 根文档 [README.md](../README.md)：快速启动与全局概览
2. [components.md](./components.md)：集成接入
3. [architecture.md](./architecture.md)：链路与状态机
4. [server-api-contract.md](./server-api-contract.md)：后端对接
5. [demo-script.md](./demo-script.md)：演示/验收
6. [interview.md](./interview.md)：面试准备

## 二、历史归档（`docs/archive/`，不再随代码更新）

保留当时的分析与实施记录，用于追溯决策；结论以现行文档为准。

| 文档                                                                         | 内容                                       | 基线                |
| ---------------------------------------------------------------------------- | ------------------------------------------ | ------------------- |
| [PROJECT_ANALYSIS.md](./archive/PROJECT_ANALYSIS.md)                         | 全面分析评分卡（功能/性能/规范/包体）      | v2.0.1 · 2026-10-24 |
| [project-analysis.md](./archive/project-analysis.md)                         | 全面分析报告与 P0/P1/P2 问题清单           | v1.0.5 · 2026-10-23 |
| [implementation-checklist.md](./archive/implementation-checklist.md)         | 阶段一~四实施清单与验收证据                | v1.0.5 → v2.0.0     |
| [IMPLEMENTATION_CHECKLIST.md](./archive/IMPLEMENTATION_CHECKLIST.md)         | 质量提升跟踪总表                           | v2.0.x              |
| [dependency-slimming-analysis.md](./archive/dependency-slimming-analysis.md) | vitest 升级 / 去 ahooks / 去 antd 决策记录 | v1.0.5              |

## 三、文档维护约定

- **版本变更同步顺序**：README（用法）→ components.md（API）→ architecture.md（设计）→ CHANGELOG（记录）。
- **破坏性变更**（如 v3.0.0 移除 `SimpleUploadList` / `SimpleDownloadList` 与 `/simple` 子路径）必须在 README 给出迁移写法，并在 CHANGELOG 的 Removed 段落登记。
- **阶段任务完成后**将分析/清单移入 `archive/`，并在文首标注归档版本与日期；归档文档不再回改正文（除更正失效链接）。
- README 与 `architecture.md` 的架构/时序/状态机图均为**手写 SVG**（`docs/assets/readme/`、`docs/assets/architecture/`），直接编辑即可，无渲染工具依赖。

## 四、运维补充

- SQLite 可视化工具（DB Browser for SQLite）：https://sqlitebrowser.org/dl/
- 默认数据库文件：`../server/data/indexeddb-upload.sqlite`
