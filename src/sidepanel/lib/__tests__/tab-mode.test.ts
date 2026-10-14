import { describe, expect, it } from "vitest";
import type { EditorPhase } from "@/store/editor-store";
import {
  listTargetCandidates,
  shouldActivateTarget,
  shouldRestorePanel,
  tabModeGate,
  targetHoldFromState,
} from "../tab-mode";

describe("shouldActivateTarget — 같은 창에서 대상이 가려져 있을 때만 앞으로", () => {
  const target = { id: 7, windowId: 1, active: false };

  it("self가 없으면(사이드패널) 활성화하지 않는다", () => {
    expect(shouldActivateTarget({ self: null, target })).toBe(false);
  });

  it("다른 창이면(별도 창 탭 모드) 양쪽이 이미 보이므로 하지 않는다", () => {
    expect(shouldActivateTarget({ self: { id: 9, windowId: 2 }, target })).toBe(false);
  });

  it("같은 창이어도 대상이 이미 활성이면 하지 않는다", () => {
    expect(
      shouldActivateTarget({ self: { id: 9, windowId: 1 }, target: { ...target, active: true } }),
    ).toBe(false);
  });

  it("같은 창 + 대상 비활성 → 활성화", () => {
    expect(shouldActivateTarget({ self: { id: 9, windowId: 1 }, target })).toBe(true);
  });

  it("창 정보가 없으면 같은 창으로 추정하지 않는다", () => {
    expect(shouldActivateTarget({ self: { id: 9 }, target: { id: 7, active: false } })).toBe(false);
  });

  it("대상이 self 자신이면 하지 않는다", () => {
    expect(shouldActivateTarget({ self: { id: 7, windowId: 1 }, target })).toBe(false);
  });
});

describe("shouldRestorePanel — 대상이 여전히 앞일 때만 패널로", () => {
  it("대상이 닫혔으면 복원하지 않는다", () => {
    expect(shouldRestorePanel({ target: null })).toBe(false);
  });

  it("대상이 비활성(사용자가 제3 탭으로 감)이면 포커스를 빼앗지 않는다", () => {
    expect(shouldRestorePanel({ target: { id: 7, active: false } })).toBe(false);
  });

  it("대상이 여전히 활성이면 복원", () => {
    expect(shouldRestorePanel({ target: { id: 7, active: true } })).toBe(true);
  });
});

describe("targetHoldFromState — 상태 기반 hold 표", () => {
  const phases: EditorPhase[] = [
    "idle",
    "picking",
    "styling",
    "capturing",
    "recording",
    "drafting",
    "previewing",
    "done",
  ];

  it.each(phases)("%s × inline=false — picking만 hold", (phase) => {
    expect(targetHoldFromState({ phase, inline: false })).toEqual({
      picking: phase === "picking",
      inline: false,
    });
  });

  it.each(phases)("%s × inline=true — inline hold는 phase와 무관", (phase) => {
    expect(targetHoldFromState({ phase, inline: true })).toEqual({
      picking: phase === "picking",
      inline: true,
    });
  });

  // 영역 드래그는 사용자가 직접 대상 탭으로 간다 — 패널 하단 뷰포트·전체 페이지 버튼을 가리지 않는다.
  it("capturing은 hold하지 않는다", () => {
    expect(targetHoldFromState({ phase: "capturing", inline: false }).picking).toBe(false);
  });

  // before 캡처는 styling 전이보다 늦게 끝나므로 phase가 아니라 명시 hold가 맡는다.
  it("styling은 hold하지 않는다", () => {
    expect(targetHoldFromState({ phase: "styling", inline: false }).picking).toBe(false);
  });
});

describe("listTargetCandidates — 대상 탭 후보", () => {
  const self = { id: 100, windowId: 1 };

  it("self와 미지원 탭을 빼고, 같은 창을 먼저 두되 그룹 안 순서는 유지한다", () => {
    const tabs = [
      { id: 1, windowId: 2, url: "https://a.example/" },
      { id: 100, windowId: 1, url: "chrome-extension://x/src/sidepanel/index.html" },
      { id: 2, windowId: 1, url: "https://b.example/" },
      { id: 3, windowId: 1, url: "chrome://settings" },
      { id: 4, windowId: 2, url: "https://chromewebstore.google.com/detail/x" },
      { id: 5, windowId: 1, url: "file:///tmp/a.html" },
      { id: 6, windowId: 3, url: "http://c.example/" },
      { id: 7, windowId: 1, url: "chrome-extension://other/page.html" },
    ];
    expect(listTargetCandidates(tabs, self).map((t) => t.id)).toEqual([2, 5, 1, 6]);
  });

  it("id가 없거나 url이 없는 탭은 후보가 아니다", () => {
    const tabs = [
      { windowId: 1, url: "https://a.example/" },
      { id: 2, windowId: 1 },
      { id: 3, windowId: 1, url: "https://b.example/" },
    ];
    expect(listTargetCandidates(tabs, self).map((t) => t.id)).toEqual([3]);
  });

  it("후보가 없으면 빈 배열", () => {
    expect(listTargetCandidates([{ id: 100, windowId: 1, url: "https://a/" }], self)).toEqual([]);
  });
});

describe("tabModeGate — 탭 모드에서 쿼리 없이 열렸을 때만 대상 선택", () => {
  const panelBase = "chrome-extension://abc/src/sidepanel/index.html";

  it("쿼리 없음 + getSelfTab 대기 중이면 pending", () => {
    expect(tabModeGate({ self: undefined, href: panelBase, panelBase })).toBe("pending");
    expect(tabModeGate({ self: undefined, href: `${panelBase}?tabId=1.5`, panelBase })).toBe("pending");
  });

  it("정수 쿼리면 getSelfTab을 기다리지 않고 bound — 사이드패널 정상 경로를 새 비동기 게이트 뒤로 세우지 않는다", () => {
    expect(tabModeGate({ self: undefined, href: `${panelBase}?tabId=7`, panelBase })).toBe("bound");
  });

  it("사이드패널(self=null)은 쿼리와 무관하게 sidepanel — 기존 바인딩 경로 그대로", () => {
    expect(tabModeGate({ self: null, href: panelBase, panelBase })).toBe("sidepanel");
    expect(tabModeGate({ self: null, href: `${panelBase}?tabId=7`, panelBase })).toBe("sidepanel");
  });

  it("탭 모드 + 쿼리 없음 → pick", () => {
    expect(tabModeGate({ self: { id: 9 }, href: panelBase, panelBase })).toBe("pick");
  });

  it("탭 모드 + 정수 아닌 쿼리 → pick (useBoundTabId는 1.5도 받지만 App 판정은 파서만 본다)", () => {
    expect(tabModeGate({ self: { id: 9 }, href: `${panelBase}?tabId=1.5`, panelBase })).toBe("pick");
    expect(tabModeGate({ self: { id: 9 }, href: `${panelBase}?tabId=abc`, panelBase })).toBe("pick");
  });

  it("탭 모드 + 정수 쿼리 → bound", () => {
    expect(tabModeGate({ self: { id: 9 }, href: `${panelBase}?tabId=7`, panelBase })).toBe("bound");
  });
});
