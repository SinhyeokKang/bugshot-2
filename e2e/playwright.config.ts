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
  // 두 스위트로 분리한다.
  // - sidepanel: 확장 구동 메인 스위트(결정적 게이트).
  // - logview: 확장 없이 dist-log-viewer/index.html을 직접 여는 standalone HTML.
  // (30s Replay 캡처 spec은 captureVisibleTab cold-start/quota로 환경 flaky가 심해 제거함 — GOTCHAS 참조.)
  projects: [
    {
      name: "sidepanel",
      testIgnore: ["**/logview/**"],
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
