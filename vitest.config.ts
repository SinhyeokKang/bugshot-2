import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // e2e/*.spec.ts는 Playwright 전용 — vitest 기본 include가 수집하면 test()가 throw.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
