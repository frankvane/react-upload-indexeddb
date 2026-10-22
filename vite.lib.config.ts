import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";

// 库构建配置：产出可被消费的 ESM + CJS 包（不含 demo 站点）。
// demo 站点走默认的 vite.config.ts（vite / build:demo）。
export default defineConfig({
  plugins: [react()],
  // 库构建不复制 public/ 静态资源（vite.svg 等），保持 dist 干净
  publicDir: false,
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format === "es" ? "js" : "cjs"}`,
    },
    sourcemap: true,
    rollupOptions: {
      // 框架级 / 单例依赖交给消费方提供，避免重复实例与体积膨胀。
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "antd",
        "antd/es",
        "@ant-design/icons",
        "zustand",
        "zustand/react/shallow",
        "ahooks",
        "localforage",
        "spark-md5",
        "axios",
      ],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          antd: "antd",
          zustand: "zustand",
        },
      },
    },
  },
});
