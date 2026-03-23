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
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.{ts,tsx}"],
      css: true,
      clearMocks: true,
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
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, "/");

            if (normalizedId.includes("/node_modules/")) {
              if (
                normalizedId.includes("/@ant-design/icons/") ||
                normalizedId.includes("/ant-design-icons/")
              ) {
                return "vendor-antd-icons";
              }

              if (
                normalizedId.includes("/antd/es/table/") ||
                normalizedId.includes("/antd/es/pagination/") ||
                normalizedId.includes("/rc-table/") ||
                normalizedId.includes("/rc-pagination/") ||
                normalizedId.includes("/rc-virtual-list/")
              ) {
                return "vendor-antd-table";
              }

              if (
                normalizedId.includes("/antd/es/modal/") ||
                normalizedId.includes("/antd/es/drawer/") ||
                normalizedId.includes("/antd/es/tooltip/") ||
                normalizedId.includes("/rc-dialog/") ||
                normalizedId.includes("/rc-drawer/") ||
                normalizedId.includes("/rc-tooltip/") ||
                normalizedId.includes("/rc-trigger/")
              ) {
                return "vendor-antd-overlay";
              }

              if (
                normalizedId.includes("/antd/es/form/") ||
                normalizedId.includes("/rc-field-form/")
              ) {
                return "vendor-antd-form";
              }

              if (
                normalizedId.includes("/antd/es/input/") ||
                normalizedId.includes("/antd/es/input-number/") ||
                normalizedId.includes("/antd/es/select/") ||
                normalizedId.includes("/rc-input/") ||
                normalizedId.includes("/rc-input-number/") ||
                normalizedId.includes("/rc-select/")
              ) {
                return "vendor-antd-input";
              }

              if (
                normalizedId.includes("/antd/es/date-picker/") ||
                normalizedId.includes("/antd/es/calendar/") ||
                normalizedId.includes("/rc-picker/") ||
                normalizedId.includes("/dayjs/")
              ) {
                return "vendor-antd-picker";
              }

              if (
                normalizedId.includes("/antd/es/progress/") ||
                normalizedId.includes("/antd/es/statistic/") ||
                normalizedId.includes("/rc-progress/")
              ) {
                return "vendor-antd-visual";
              }

              if (
                normalizedId.includes("/antd/") ||
                normalizedId.includes("/@ant-design/") ||
                normalizedId.includes("/rc-")
              ) {
                return "vendor-antd-core";
              }

              if (
                normalizedId.includes("/react/") ||
                normalizedId.includes("/react-dom/") ||
                normalizedId.includes("/scheduler/")
              ) {
                return "vendor-react";
              }

              if (
                normalizedId.includes("/axios/") ||
                normalizedId.includes("/ahooks/") ||
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
