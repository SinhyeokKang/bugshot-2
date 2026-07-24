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
    // 컴포넌트 렌더 테스트(*.test.tsx)만 jsdom. 순수 함수 테스트는 node 유지.
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    setupFiles: ["./src/test/setup-dom.ts"],
    coverage: {
      // 전체 정직한 분모를 유지한다(브라우저 전용/UI 코드 포함). "로직 스코프"
      // 파티션·비교·개선 후보 랭킹은 scripts/coverage-report.mjs가 담당.
      provider: "v8",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.test.*",
        "src/**/*.d.ts",
        "src/test/**",
      ],
    },
  },
});
