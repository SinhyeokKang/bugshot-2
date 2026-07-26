import { describe, it, expect } from "vitest";
import { areLogTabsLocked, shouldSyncRecorders } from "../debugTabGates";

// DebugTab 풀 렌더는 IssueTab(→ DraftingPanel·PreviewPanel·StyleEditorPanel)을 무조건
// 마운트해 tiptap·sonner까지 끌어오므로, 잠금·폴링 판정만 순수 술어로 빼서 여기서 잠근다.
// 서브탭 trigger의 실제 disabled 렌더는 e2e가 담당한다.

describe("areLogTabsLocked", () => {
  it("녹화 중이면 잠긴다 (기존 동작)", () => {
    expect(areLogTabsLocked({ phase: "recording", unsupported: false })).toBe(true);
  });

  it("미지원 페이지면 잠긴다 (신규)", () => {
    expect(areLogTabsLocked({ phase: "idle", unsupported: true })).toBe(true);
  });

  it("둘 다면 잠긴다", () => {
    expect(areLogTabsLocked({ phase: "recording", unsupported: true })).toBe(true);
  });

  it("지원 페이지 + 녹화 중 아니면 열린다", () => {
    for (const phase of ["idle", "picking", "capturing", "styling", "drafting", "previewing", "done"]) {
      expect(areLogTabsLocked({ phase, unsupported: false })).toBe(false);
    }
  });
});

describe("shouldSyncRecorders", () => {
  const base = { activeMainTab: "debug", sub: "issue", unsupported: false };

  it("debug 탭 + issue 서브탭 + 지원 페이지면 동기화한다", () => {
    expect(shouldSyncRecorders(base)).toBe(true);
  });

  it("미지원 페이지면 동기화하지 않는다 (1.5초마다 영구 실패하는 폴링 차단)", () => {
    expect(shouldSyncRecorders({ ...base, unsupported: true })).toBe(false);
  });

  it("다른 메인 탭이면 동기화하지 않는다 (기존 동작)", () => {
    for (const activeMainTab of ["issue-list", "integrations", "settings"]) {
      expect(shouldSyncRecorders({ ...base, activeMainTab })).toBe(false);
    }
  });

  it("console/network 서브탭이면 동기화하지 않는다 (기존 동작 — 각 서브탭이 자체 폴링)", () => {
    expect(shouldSyncRecorders({ ...base, sub: "console" })).toBe(false);
    expect(shouldSyncRecorders({ ...base, sub: "network" })).toBe(false);
  });
});
