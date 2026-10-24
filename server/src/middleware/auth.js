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
// 默认 fail-closed（拒绝优先）：
//   - 只要拿到有效凭据（Bearer token 命中白名单 / Cookie 命中 / verify 放行）才 next()；
//   - 否则一律 401，绝不静默放行。
//   - 唯一的“放开口子”是显式传入 requireAuth:false（demo / 测试场景由 app.js 决定）。
//     app.js 仅在明确配置 REQUIRE_FILE_AUTH=true 时才挂载本中间件，且永远以
//     requireAuth:true 挂载；因此生产路径绝不会出现“开了开关却 silently 全开”。
//
// 历史坑（已修复）：旧实现中若中间件“已挂载却未配置任何凭据”，enabled 为 false 会
// 直接 next() 放行全部请求——即“本应受保护却 silently 全开”。现在改为 fail-closed：
// 挂载即代表要求鉴权，缺凭据时所有请求都被拒绝，而非放行。
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
    requireAuth = true, // 默认 fail-closed：未提供有效凭据即拒绝
  } = options;

  return function authMiddleware(req, res, next) {
    // 显式关闭（demo / 测试）：直接放行，不做任何校验。
    if (requireAuth === false) return next();

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

    // fail-closed：无论是否配置了校验，只要没拿到有效凭据就拒绝。
    // 唯一的放开口子是 requireAuth === false（由 app.js 在 demo/测试场景显式传入）。
    return res.status(401).json({ code: 401, message: "未授权", data: {} });
  };
}

module.exports = { createAuthMiddleware, parseCookies };
