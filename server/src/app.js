const cors = require("cors");
const express = require("express");
const morgan = require("morgan");
const fileRoutes = require("./routes/fileRoutes");
const { createAuthMiddleware } = require("./middleware/auth");

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === "test" ? "tiny" : "dev"));

app.get("/api/health", (_req, res) => {
  res.json({
    code: 200,
    message: "ok",
    data: {
      now: new Date().toISOString(),
    },
  });
});

// 文件上传/下载接口鉴权（参考实现，默认关闭）。
// 设 REQUIRE_FILE_AUTH=true 并配置 FILE_AUTH_TOKEN / FILE_AUTH_COOKIE 后启用；
// vane-crm 接入时应替换为自家鉴权（portal_token 校验 + RBAC）。
if (process.env.REQUIRE_FILE_AUTH === "true") {
  const bearerTokens = (process.env.FILE_AUTH_TOKEN || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const cookieName = process.env.FILE_AUTH_COOKIE || undefined;
  app.use(
    "/api/file",
    createAuthMiddleware({ bearerTokens, cookieName })
  );
}

app.use("/api/file", fileRoutes);

app.use((error, _req, res, _next) => {
  res.status(500).json({
    code: 500,
    message: error.message || "internal server error",
    data: {},
  });
});

module.exports = app;
