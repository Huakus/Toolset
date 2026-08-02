import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-v2",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "v2.html"),
    },
  },
});
