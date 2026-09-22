import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// main.tsx는 어떤 테스트도 import하지 않는다(엔트리 — 최상단에서 chrome.storage·ReactDOM을
// 즉시 만진다). 그래서 크로스 인스턴스 동기화 리스너 세 줄을 지워도 전 스위트가 green이었다.
// persist merge 배선엔 그물을 깔았으니(issues-store.test.ts "persist 옵션 배선") 트리거 축도
// 같은 논리로 잠근다 — 소스 스캔이 이 파일에 쓸 수 있는 유일한 형태다.
describe("사이드패널 엔트리의 issues 동기화 배선", () => {
  const src = readFileSync(
    new URL("../main.tsx", import.meta.url),
    "utf8",
  );

  it("ISSUES_PERSIST_KEY 변경을 에코 가드를 거쳐 rehydrate로 넘긴다", () => {
    expect(src).toContain("ISSUES_PERSIST_KEY");
    expect(src).toContain("shouldSyncIssuesChange(changes[ISSUES_PERSIST_KEY])");
    expect(src).toContain("rehydrateIssuesFromExternalWrite()");
  });

  // throttle을 벗기면 배지 버스트가 전체 blob rehydrate를 N번 태운다.
  it("rehydrate를 trailing throttle로 접는다", () => {
    expect(src).toContain("createTrailingThrottle");
    expect(src).toContain("issuesSync.schedule()");
  });

  // 같은 리스너에 얹혀 있어서 settings 분기를 건드리다 issues 분기가 같이 죽을 수 있다.
  it("settings 토큰 동기화 분기가 함께 살아있다", () => {
    expect(src).toContain("SETTINGS_STORAGE_KEY");
    expect(src).toContain("useSettingsStore.persist.rehydrate()");
  });
});
