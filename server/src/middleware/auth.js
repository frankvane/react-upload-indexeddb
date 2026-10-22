// 可插拔鉴权中间件（参考实现）。
//
// 发布为「仅客户端组件库」时，本文件作为服务端对接示例：
// vane-crm 应替换为自家鉴权（如 portal_token 校验 + RBAC），但接口形态一致——
// 校验不通过返回 401 `{ code: 401, message, data: {} }`，与前端 401 处理对齐。
//
// 支持两种来源（任一即通过）：
//   1) Authorization: Bearer <token>（跨域常用，前端 getAuthHeaders/getAuthToken 注入）
//   2) 同域 Cookie（前端 axios withCredentials / Worker credentials:'include' 自动携带）
//
// 默认不开启：仅当 process.env.REQUIRE_FILE_AUTH === 'true' 时 app.js 才会挂载，
// 以免破坏本地演示与集成测试。生产接入时把 verify 换成真实 JWT/session 校验。
function parseCookies(header) {
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return acc;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) acc[k] = decodeURIComponent(v);
    return acc;
  }, {});
}

function createAuthMiddleware(options = {}) {
  const {
    bearerTokens = [],
    cookieName,
    verify, // (token, req, next) => void；返回 void 即放行，否则自行 res 结束
  } = options;

  const enabled = Boolean(verify) || bearerTokens.length > 0 || Boolean(cookieName);

  return function authMiddleware(req, res, next) {
    // 未配置任何校验 → 放行（本地/演示默认）
    if (!enabled) return next();

    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");
    if (scheme === "Bearer" && token) {
      if (verify) return verify(token, req, next);
      if (bearerTokens.includes(token)) return next();
    }

    if (cookieName) {
      const cookies = parseCookies(req.headers.cookie);
      const cookieValue = cookies[cookieName];
      if (cookieValue) {
        if (verify) return verify(cookieValue, req, next);
        return next();
      }
    }

    return res.status(401).json({ code: 401, message: "未授权", data: {} });
  };
}

module.exports = { createAuthMiddleware, parseCookies };
