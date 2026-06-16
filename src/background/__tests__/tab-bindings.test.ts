import { describe, it, expect } from "vitest";
import {
  shouldPreserveSession,
  resolveTabSwitch,
  resolveNavigationAction,
  isBroadCoveredUrl,
} from "../tab-bindings";

describe("shouldPreserveSession", () => {
  it("returns false for undefined snap", () => {
    expect(shouldPreserveSession(undefined)).toBe(false);
  });

  it("returns false for empty snap", () => {
    expect(shouldPreserveSession({})).toBe(false);
  });

  it("returns true for video mode regardless of phase", () => {
    expect(shouldPreserveSession({ captureMode: "video", phase: "recording" })).toBe(true);
    expect(shouldPreserveSession({ captureMode: "video", phase: "drafting" })).toBe(true);
    expect(shouldPreserveSession({ captureMode: "video", phase: "idle" })).toBe(true);
    expect(shouldPreserveSession({ captureMode: "video" })).toBe(true);
  });

  const frozenModes = ["screenshot", "element", "freeform"] as const;
  const frozenPhases = ["drafting", "previewing", "done"] as const;
  const nonFrozenPhases = ["idle", "picking", "styling", "capturing", "recording"] as const;

  for (const mode of frozenModes) {
    it(`returns true for ${mode} in frozen phases`, () => {
      for (const phase of frozenPhases) {
        expect(shouldPreserveSession({ captureMode: mode, phase })).toBe(true);
      }
    });

    it(`returns false for ${mode} in non-frozen phases`, () => {
      for (const phase of nonFrozenPhases) {
        expect(shouldPreserveSession({ captureMode: mode, phase })).toBe(false);
      }
    });
  }

  it("returns false for unknown captureMode", () => {
    expect(shouldPreserveSession({ captureMode: "unknown", phase: "drafting" })).toBe(false);
  });
});

describe("resolveTabSwitch", () => {
  it("returns null on first activation in a window and records it", () => {
    const map = new Map<number, number>();
    expect(resolveTabSwitch(map, 1, 10)).toBeNull();
    expect(map.get(1)).toBe(10);
  });

  it("returns the previous tab on switch within the same window", () => {
    const map = new Map<number, number>([[1, 10]]);
    expect(resolveTabSwitch(map, 1, 20)).toBe(10);
    expect(map.get(1)).toBe(20);
  });

  it("returns null when re-activating the same tab", () => {
    const map = new Map<number, number>([[1, 10]]);
    expect(resolveTabSwitch(map, 1, 10)).toBeNull();
    expect(map.get(1)).toBe(10);
  });

  it("tracks each window independently (no cross-window stop)", () => {
    const map = new Map<number, number>();
    expect(resolveTabSwitch(map, 1, 10)).toBeNull();
    expect(resolveTabSwitch(map, 2, 20)).toBeNull();
    // switching back to window 1 stops window 1's prev, not window 2's visible tab
    expect(resolveTabSwitch(map, 1, 11)).toBe(10);
    expect(map.get(2)).toBe(20);
  });
});

describe("resolveNavigationAction", () => {
  type Input = Parameters<typeof resolveNavigationAction>[0];
  type Case = { name: string; input: Input; expected: ReturnType<typeof resolveNavigationAction> };

  // 광역 미보유(broadGranted=false) — 미보유 사용자 현행 동작을 고정한다(최대 회귀 리스크).
  const legacyCases: Case[] = [
    {
      name: "보존 + same-origin → keep (pageKeyChanged 무관)",
      input: { preserved: true, sameOrigin: true, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: false },
      expected: "keep",
    },
    {
      name: "보존 + cross-origin → notifyDeferredExpiry",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: false },
      expected: "notifyDeferredExpiry",
    },
    {
      name: "비보존 + same-origin + pageKey 변경 → clearSession",
      input: { preserved: false, sameOrigin: true, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: false },
      expected: "clearSession",
    },
    {
      name: "비보존 + same-origin + pageKey 유지 → keep",
      input: { preserved: false, sameOrigin: true, pageKeyChanged: false, broadGranted: false, newUrlBroadCovered: false },
      expected: "keep",
    },
    {
      name: "비보존 + cross-origin → deactivate",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: false },
      expected: "deactivate",
    },
    // 미보유 사용자의 가장 흔한 현실 입력 — 새 URL이 커버 범위(http/https)여도 권한이 없으면 현행 분기.
    {
      name: "미보유 + 보존 + cross-origin + 커버 URL → notifyDeferredExpiry",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: true },
      expected: "notifyDeferredExpiry",
    },
    {
      name: "미보유 + 비보존 + cross-origin + 커버 URL → deactivate",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: false, newUrlBroadCovered: true },
      expected: "deactivate",
    },
  ];

  // 광역 보유(broadGranted=true) + 광역 커버 URL(newUrlBroadCovered=true) → cross-origin을 same-origin처럼.
  const broadCoveredCases: Case[] = [
    {
      name: "광역 보유 + 비보존 + cross-origin + 커버 URL → clearSession (패널 유지)",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: true },
      expected: "clearSession",
    },
    {
      name: "광역 보유 + 보존 + cross-origin + 커버 URL → keep (deferred 예약 없음)",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: true },
      expected: "keep",
    },
  ];

  // 광역 보유하지만 비커버 URL(file: 등, newUrlBroadCovered=false) → 현행 분기로 폴백.
  const broadUncoveredCases: Case[] = [
    {
      name: "광역 보유 + 비보존 + cross-origin + 비커버 URL(file:) → deactivate (현행)",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false },
      expected: "deactivate",
    },
    {
      name: "광역 보유 + 보존 + cross-origin + 비커버 URL(file:) → notifyDeferredExpiry (현행)",
      input: { preserved: true, sameOrigin: false, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: false },
      expected: "notifyDeferredExpiry",
    },
  ];

  // 입력 합성 불변식 — same-origin이면 broadGranted/newUrlBroadCovered가 결과에 영향 없음.
  const invariantCases: Case[] = [
    {
      name: "same-origin이면 broadGranted=true여도 비보존+pageKey 변경 → clearSession",
      input: { preserved: false, sameOrigin: true, pageKeyChanged: true, broadGranted: true, newUrlBroadCovered: true },
      expected: "clearSession",
    },
    {
      name: "광역 보유 + 비보존 + cross-origin + 커버 + pageKey 유지(refUrl 동일 path) → keep",
      input: { preserved: false, sameOrigin: false, pageKeyChanged: false, broadGranted: true, newUrlBroadCovered: true },
      expected: "keep",
    },
  ];

  for (const c of [...legacyCases, ...broadCoveredCases, ...broadUncoveredCases, ...invariantCases]) {
    it(c.name, () => {
      expect(resolveNavigationAction(c.input)).toBe(c.expected);
    });
  }
});

// BROAD_HOST_ORIGINS를 <all_urls>로 전환하면 광역 권한이 file:까지 포함하지만,
// captureVisibleTab은 file:에 별도 "파일 URL 액세스" 토글을 요구하므로 navigation 분기는
// file:을 의도적으로 비커버(만료 폴백)로 유지해야 한다. 이 경계가 깨지지 않음을 락인한다.
describe("isBroadCoveredUrl", () => {
  it("returns true for https URL", () => {
    expect(isBroadCoveredUrl("https://example.com/path")).toBe(true);
  });

  it("returns true for http URL", () => {
    expect(isBroadCoveredUrl("http://example.com")).toBe(true);
  });

  it("returns false for file: URL (<all_urls> includes it but capture needs a separate toggle)", () => {
    expect(isBroadCoveredUrl("file:///Users/me/page.html")).toBe(false);
  });

  it("returns false for unsupported scheme (chrome:)", () => {
    expect(isBroadCoveredUrl("chrome://settings")).toBe(false);
  });

  it("returns false for blocked host (chromewebstore)", () => {
    expect(isBroadCoveredUrl("https://chromewebstore.google.com/detail/x")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isBroadCoveredUrl(undefined)).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(isBroadCoveredUrl("not a url")).toBe(false);
  });
});
