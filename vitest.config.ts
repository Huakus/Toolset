import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/v2/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
