import { defineConfig } from "@playwright/test";

// 30s Replay 캡처 spec(replay-button → captureVisibleTab → drafting). 별도 project로 격리.
const REPLAY_SPECS = [
  "**/replay-action-log.spec.ts",
  "**/replay-trim.spec.ts",
  "**/replay-trim-logs.spec.ts",
  "**/action-log-coverage.spec.ts",
  "**/drag-action.spec.ts",
];

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
  // 세 스위트로 분리한다.
  // - sidepanel: 확장 구동 메인 스위트(결정적 게이트).
  // - replay: 30s Replay 캡처(captureVisibleTab) spec. cold-start/extension-global quota로
  //   환경 flaky라(README 함정) 메인 게이트를 오염시키지 않게 떼고, capture 인프라 회복을 위해
  //   이 project에만 retries를 둔다(코드 flaky 은폐가 아니라 captureVisibleTab 재시도-회복).
  // - logview: 확장 없이 dist-log-viewer/index.html을 직접 여는 standalone HTML.
  projects: [
    {
      name: "sidepanel",
      testIgnore: ["**/logview/**", ...REPLAY_SPECS],
    },
    {
      name: "replay",
      testMatch: REPLAY_SPECS,
      dependencies: ["sidepanel"],
      // captureVisibleTab cold-start/quota는 환경 요인이라 첫 시도 실패 후 warm 재시도로 회복된다.
      retries: 2,
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
