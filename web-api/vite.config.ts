import { defineConfig } from "vite";
import { resolve } from "path";

// The API runs on Node, so the bundle is built in SSR mode. Without it Vite
// targets the browser and replaces Node builtins such as `child_process` and
// `events` with stubs that fail at build time.
export default defineConfig({
  build: {
    outDir: "dist",
    ssr: true,
    rollupOptions: {
      input: resolve(__dirname, "src/index.ts"),
      external: ["express", "swagger-ui-express", "onoff", "openapi3-ts"],
      output: {
        format: "es",
        entryFileNames: "index.js",
      },
    },
    target: "node16",
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
});
