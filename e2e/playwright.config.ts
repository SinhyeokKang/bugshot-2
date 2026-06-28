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
  // 두 스위트로 분리한다. log-viewer는 확장 없이 dist-log-viewer/index.html을 직접 여는
  // standalone HTML이라 별도 project로 떼고, 사이드패널 project가 green일 때만 뒤따라 돈다.
  projects: [
    {
      name: "sidepanel",
      testIgnore: "**/logview/**",
    },
    {
      name: "logview",
      testMatch: "**/logview/**/*.spec.ts",
      dependencies: ["sidepanel"],
      // 로그 뷰어는 넓은 화면용(좌우 분할·필터 탭 가로 배열). 좁으면 라벨이 접히므로 폭 고정.
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
});
