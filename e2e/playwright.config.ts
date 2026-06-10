import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  // 확장 + persistent context는 프로필 단위 상태라 병렬 불가.
  workers: 1,
  // flaky를 숨기지 않는다.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
  },
});
