import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";

// 库构建配置：产出可被消费的 ESM + CJS 包（不含 demo 站点）。
// demo 站点走默认的 vite.config.ts（vite / build:demo）。
export default defineConfig({
  plugins: [react()],
  // 库构建不复制 public/ 静态资源（vite.svg 等），保持 dist 干净
  publicDir: false,
  // 关键：worker chunk（filePrepareWorker/uploadWorker/merger/downloader）经
  // `new URL('...', import.meta.url)` 引用，默认 base '/' 会生成绝对路径
  // `/assets/xxx.js`，被消费方 Vite（dev/构建）解析到站点根 → 404 → 文件预处理失败。
  // 设为 './' 让 worker URL 相对引用，随 import.meta.url 落到库自身目录，消费方直接可用。
  base: "./",
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
        "localforage",
        // 注意：spark-md5 不能 external —— 它被 filePrepareWorker / uploadWorker 引用，
        // 而 Worker 运行时无法解析裸模块导入；改用 Vite `?worker&inline` 把 worker
        // （连同 spark-md5）整体内联为 Blob，消费方 dev/构建都无需再解析外部 worker 资产。
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
