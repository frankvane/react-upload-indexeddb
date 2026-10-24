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

## 鉴权（默认关闭，生产必须开启）

demo server 的文件接口（`/api/file`）**默认不鉴权**，仅供本地开发 / 演示。任何生产部署都必须开启鉴权，否则任意客户端都能上传 / 下载文件。

开启方式（见 `.env.example`）：

```bash
REQUIRE_FILE_AUTH=true
FILE_AUTH_TOKEN=your-secret-token        # Bearer 白名单，逗号分隔可配多个
# 或
FILE_AUTH_COOKIE=session_id              # 同域 Cookie 名（需配合 CORS_ORIGIN 具体域名 + withCredentials）
```

鉴权中间件为 **fail-closed（拒绝优先）**：

- 只有拿到有效凭据（`Authorization: Bearer <token>` 命中白名单，或同域 Cookie 命中，或自定义 `verify` 放行）才放行；否则 **一律 401**，绝不静默放行。
- 若 `REQUIRE_FILE_AUTH=true` 却**未配置任何凭据**，服务器会打印 `FATAL` 告警，并让所有 `/api/file` 请求返回 401——不会出现「本应受保护却 silently 全开」的情况。
- 默认关闭（`REQUIRE_FILE_AUTH` 未设或 `false`）时接口完全开放，便于本地 demo / 集成测试。

> vane-crm 等实际项目接入时，应将本中间件替换为自家鉴权（如 `portal_token` 校验 + RBAC），但对外契约一致：校验失败返回 `401 { code:401, message, data:{} }`，与前端 401 处理逻辑对齐。
