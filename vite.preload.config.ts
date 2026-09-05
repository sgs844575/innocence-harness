import { defineConfig } from "vite";

// Sandbox preloads must stay CommonJS (no ESM imports in the sandboxed world).
export default defineConfig({
  build: {
    lib: {
      entry: { preload: "src/preload/index.ts", computerActivityPreload: "src/preload/computerActivity.ts" },
      formats: ["cjs"],
      fileName: (_format, name) => `${name}.js`,
    },
    outDir: ".vite/build",
    rollupOptions: {
      external: ["electron"],
    },
  },
});
