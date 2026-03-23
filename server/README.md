# indexeddb-upload Server

## 技术栈

- Node.js + Express
- Sequelize
- SQLite（通过 `better-sqlite3` 适配器接入）

## 启动

1. 安装依赖：`npm install`
2. 启动服务：`npm run dev`

默认监听：`http://localhost:3000`

## 接口前缀

所有接口统一挂在：

- `/api/file/*`

详细契约见：`../docs/server-api-contract.md`

## 测试

- `npm run test`

当前集成测试覆盖：

- `instant` 契约结构
- `upload + status` 链路
- `list` 返回结构
- `download Range` 断点响应

## SQLite 可视化管理（可选）

- 推荐工具：`DB Browser for SQLite`
- 下载地址：https://sqlitebrowser.org/dl/
- 默认数据库：`./data/indexeddb-upload.sqlite`
- 自定义数据库：环境变量 `DB_STORAGE`

建议在停止服务后再打开数据库文件，以减少 `database is locked` 冲突。
