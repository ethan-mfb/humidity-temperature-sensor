import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["express", "swagger-ui-express", "onoff", "openapi3-ts"],
      output: {
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
