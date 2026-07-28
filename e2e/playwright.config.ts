import { defineConfig } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: ".",
  // 확장 + persistent context는 프로필 단위 상태라 병렬 불가.
  // CI에서의 병렬성은 워크플로 매트릭스의 --shard(=러너 4대)로만 얻는다.
  workers: 1,
  // 로컬은 flaky를 숨기지 않는다. CI는 xvfb·확장 SW 기동 등 환경 flaky에 복구 기회를 한 번만 준다
  // (2 이상이면 진짜 회귀도 통과시킬 확률이 커진다).
  retries: isCI ? 1 : 0,
  // .only가 남은 채 머지되면 샤드가 조용히 green이 되어 게이트가 무의미해진다.
  forbidOnly: isCI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // github reporter는 실패를 PR diff에 인라인 annotation으로 붙인다.
  reporter: isCI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
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
      // dependencies:["sidepanel"]는 두지 않는다. logview는 확장을 로드하지 않고
      // build:e2e가 만든 dist-log-viewer만 읽는 standalone이라 실제 의존이 없고,
      // --shard 사용 시 의존 project는 샤드마다 전량 실행돼 샤딩 효과를 지운다.
      // 로그 뷰어는 넓은 화면용(좌우 분할·필터 탭 가로 배열). 좁으면 라벨이 접히므로 폭 고정.
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
});
