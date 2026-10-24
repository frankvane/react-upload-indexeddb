import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const proxyTarget = env.VITE_DEV_API_PROXY_TARGET || "http://localhost:3000";

  return {
    plugins: [react()],
    test: {
      environment: "jsdom",
      // 显式指定 pool：本沙箱环境下 vitest 5 的默认 pool 无法正常初始化
      // worker 会话（globalThis.__vitest__ 未建立，导致 describe/afterEach 报
      // "failed to find the current suite" / "reading 'config'"），改用 forks
      // 可稳定初始化会话；threads 同样可用。
      pool: "forks",
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.{ts,tsx}"],
      css: true,
      clearMocks: true,
      coverage: {
        // 注意：v8 provider 与 @vitejs/plugin-react-swc 的 AST 重映射存在已知
        // 兼容问题（vitest-dev/vitest#9293：内联组件/函数报 0% 或大幅低报），
        // 且 ast-v8-to-istanbul#120 修复后实测仍复现（2026-10-23，vitest 5.0.5
        // + plugin-react-swc 4.3.3 + vite 7.3.7）。istanbul provider 在源码级
        // 插桩，不受 SWC sourcemap 重映射影响，数字准确，故选用。
        provider: "istanbul",
        reporter: ["text", "json-summary"],
        reportsDirectory: "./coverage",
        // 只统计源码，排除测试文件本身与 demo 入口
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
          "src/**/__tests__/**",
          "src/main.tsx",
          "src/App.tsx",
          "src/vite-env.d.ts",
          "src/components/DebugPanel*",
        ],
        thresholds: {
          // 全库行覆盖门槛（ratchet 策略：设为当前可达值，逐步抬高；
          // 长期目标见 docs/implementation-checklist.md T2.8：lines/statements 60、branches 50）。
          // 2026-10-23 随 vitest 5 升级重校：coverage provider 由 v8 切 istanbul
          // （v8+SWC 重映射数字失真，见上方注释），以 istanbul 实测值重设。
          lines: 35,
          functions: 30,
          statements: 35,
          branches: 25,
          // src/shared 与 services 是纯逻辑层，门槛更高
          // 长期目标 80/80/80/75；shared 已大幅达标（96/95/100/97），services 按当前聚合值设防
          "src/shared/**": {
            lines: 80,
            functions: 80,
            statements: 80,
            branches: 75,
          },
          "src/components/**/services/**": {
            lines: 65,
            functions: 70,
            statements: 65,
            branches: 60,
          },
        },
      },
    },
    server: {
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      // demo 站点独立输出，避免与库构建产物（dist）混在一起被一起发布。
      outDir: "demo-dist",
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, "/");

            if (normalizedId.includes("/node_modules/")) {
              if (
                normalizedId.includes("/react/") ||
                normalizedId.includes("/react-dom/") ||
                normalizedId.includes("/react-is/") ||
                normalizedId.includes("/scheduler/") ||
                normalizedId.includes("/zustand/")
              ) {
                return "vendor-react";
              }

              if (
                normalizedId.includes("/axios/") ||
                normalizedId.includes("/localforage/") ||
                normalizedId.includes("/spark-md5/")
              ) {
                return "vendor-data";
              }

              return "vendor-misc";
            }

            if (normalizedId.includes("/src/components/ZustandFileUpload/")) {
              return "feature-upload";
            }

            if (normalizedId.includes("/src/components/ZustandFileDownload/")) {
              return "feature-download";
            }

            return undefined;
          },
        },
      },
    },
  };
});
