const cors = require("cors");
const express = require("express");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const fileRoutes = require("./routes/fileRoutes");
const { createAuthMiddleware } = require("./middleware/auth");

const app = express();

// CORS：默认 *（保持兼容）；生产建议 CORS_ORIGIN="https://a.com,https://b.com" 收紧。
// 通配 origin 时不能携带 credentials（浏览器规范），需要 Cookie 鉴权必须配具体 origin。
const corsOrigin = (process.env.CORS_ORIGIN || "*").trim();
const corsOptions =
  corsOrigin === "*"
    ? { origin: true }
    : {
        origin: corsOrigin
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        credentials: true,
      };
app.use(cors(corsOptions));

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === "test" ? "tiny" : "dev"));

// 限流：默认 300 次/分钟/IP（RATE_LIMIT_MAX 可调，RATE_LIMIT_ENABLED=false 关闭）。
// 测试环境默认关闭，避免 supertest 批量请求被 429 拦截。
if (
  process.env.RATE_LIMIT_ENABLED !== "false" &&
  process.env.NODE_ENV !== "test"
) {
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: Number.parseInt(process.env.RATE_LIMIT_MAX || "", 10) || 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 429, message: "too many requests", data: {} },
  });
  app.use("/api/", limiter);
}

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
//
// fail-closed 语义：本分支仅在“明确要求鉴权”时进入，且永远以 requireAuth:true 挂载，
// 因此不会出现“开了开关却静默全开”的悲剧。若 REQUIRE_FILE_AUTH=true 却未配置任何
// 凭据，则所有 /api/file 请求一律 401（并打印 FATAL 告警），而非放行。
if (process.env.REQUIRE_FILE_AUTH === "true") {
  const bearerTokens = (process.env.FILE_AUTH_TOKEN || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const cookieName = process.env.FILE_AUTH_COOKIE || undefined;
  const hasAnyConfig = bearerTokens.length > 0 || Boolean(cookieName);
  if (!hasAnyConfig) {
    // fail-closed：要求保护却未配置凭据 → 不允许 silent open，告警并一律拒绝。
    console.error(
      "[FATAL] REQUIRE_FILE_AUTH=true 但未配置 FILE_AUTH_TOKEN / FILE_AUTH_COOKIE，" +
        "所有 /api/file 请求将被拒绝（fail-closed）。请配置凭据，或将 REQUIRE_FILE_AUTH 设回 false。"
    );
  }
  app.use(
    "/api/file",
    createAuthMiddleware({ bearerTokens, cookieName, requireAuth: true })
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
