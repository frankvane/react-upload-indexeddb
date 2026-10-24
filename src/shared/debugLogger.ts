/**
 * 可关闭的调试日志（库内部统一出口）。
 *
 * 库默认 silent=true：仅真实失败以 console.error 透出，避免生产环境噪声；
 * 调试/重试提示（warn/debug）默认静默。消费方排查时调用
 * `configureDebug({ silent: false })` 即可打开全部日志。
 *
 * 设计为纯模块、无 DOM 依赖，主线程与 Worker 均可安全 import。
 */
let silent = true;

export const configureDebug = (opt: { silent?: boolean }): void => {
  if (opt.silent !== undefined) silent = opt.silent;
};

export const debugLog = (...args: unknown[]): void => {
  if (!silent) console.debug("[rui-upload]", ...args);
};

export const debugWarn = (...args: unknown[]): void => {
  if (!silent) console.warn("[rui-upload]", ...args);
};

// 真实失败始终记录，不受 silent 控制（与 console.error 原语义一致）。
export const debugError = (...args: unknown[]): void => {
  console.error("[rui-upload]", ...args);
};
