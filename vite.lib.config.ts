import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";

// 库构建配置：产出可被消费的 ESM + CJS 包（不含 demo 站点）。
// demo 站点走默认的 vite.config.ts（vite / build:demo）。
export default defineConfig({
  plugins: [react()],
  // 库构建不复制 public/ 静态资源（vite.svg 等），保持 dist 干净
  publicDir: false,
  // 关键：worker chunk（filePrepareWorker/uploadWorker/merger/downloader）经 Vite
  // `?worker&inline` 内联为 Blob（见 useFileProcessor.ts / uploadWorkerBridge.ts /
  // ZustandFileDownload/worker/index.ts），不生成外部 worker 资产，避免消费方 dev/构建
  // 解析到站点根 → 404 → 文件预处理失败。
  // base './' 让其余相对引用随 import.meta.url 落到库自身目录，消费方直接可用。
  base: "./",
  build: {
    lib: {
      // 多入口：全量（index）+ 按需子路径（upload / download）。
      // 消费方按需 `import ... from "react-upload-indexeddb/upload"` 时，
      // 打包器只拉对应入口及其独占依赖，不会带入另一条链路代码。
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        upload: resolve(__dirname, "src/upload.ts"),
        download: resolve(__dirname, "src/download.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) =>
        `${entryName}.${format === "es" ? "js" : "cjs"}`,
      // 内置 UI 套件样式输出为统一 dist/style.css（各入口共享，消费方按需引入）
      cssFileName: "style",
    },
    // 不产出 sourcemap：dist 会整包发布到 npm，.map 占比超过 70%。
    // 需要在本地调试构建产物时，可临时改为 true（不要提交）。
    sourcemap: false,
    rollupOptions: {
      // 框架级 / 单例依赖交给消费方提供，避免重复实例与体积膨胀。
      // antd 已于 T4.3 移除（内置 rui-ui 替代），不再 external。
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
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
          zustand: "zustand",
        },
      },
    },
  },
});
