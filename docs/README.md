# 文档索引（当前项目）

> 根目录主入口请先看：[../README.md](../README.md)

## 核心文档与职责

| 文档                                               | 核心职责                                                   | 不负责内容                          |
| -------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| [components.md](./components.md)                   | 组件接入说明：Props、默认值、回调、示例、接入建议          | 系统架构推演、接口字段全量契约      |
| [architecture.md](./architecture.md)               | 系统架构与链路说明：模块关系、流程图、时序图、自动策略闭环 | 逐字段 API 参数字典、逐组件接入细节 |
| [server-api-contract.md](./server-api-contract.md) | 服务端 API 契约：路径、请求/响应结构、错误约定             | UI 交互流程、组件使用方式           |
| [demo-script.md](./demo-script.md)                 | 演示与验收脚本：演示步骤、预期结果、异常排查、记录模板     | 组件参数详解、架构原理深挖          |
| [interview.md](./interview.md)                     | 面试题库与参考答案：项目亮点表达、追问准备                 | 运行手册、字段级契约、完整演示步骤  |

## 建议阅读顺序

1. 先读根文档 `README.md`（快速启动与全局概览）
2. 再读 [components.md](./components.md)（集成接入）
3. 需要理解链路时读 [architecture.md](./architecture.md)
4. 对接后端时读 [server-api-contract.md](./server-api-contract.md)
5. 走演示/验收时使用 [demo-script.md](./demo-script.md)
6. 面试准备与复盘使用 [interview.md](./interview.md)

## 运维补充

- SQLite 可视化工具（DB Browser for SQLite）：https://sqlitebrowser.org/dl/
- 默认数据库文件：`../server/data/indexeddb-upload.sqlite`
