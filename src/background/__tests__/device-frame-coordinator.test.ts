import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideDeviceSignal,
  isTopLikeFrame,
  splitTabDocuments,
  type DeviceFrameState,
} from "../device-frame-coordinator";

const TOP = "https://a.com/page";

function state(over: Partial<DeviceFrameState> = {}): DeviceFrameState {
  return {
    topUrl: TOP,
    armed: false,
    provisionalFrameId: null,
    binding: null,
    ...over,
  };
}

describe("decideDeviceSignal — 진입 판정 (arm 창 안)", () => {
  it("frameReady + arm 열림 → frameLoaded 1회, 잠정 래퍼가 확정 binding으로 승격", () => {
    const res = decideDeviceSignal(state({ armed: true, provisionalFrameId: 7 }), {
      kind: "frameReady",
      frameId: 7,
      documentId: "d1",
    });
    expect(res.push).toEqual({ type: "frameLoaded" });
    expect(res.next.binding).toEqual({ frameId: 7, documentId: "d1" });
    expect(res.next.provisionalFrameId).toBeNull();
  });

  // same-origin 불변식 때문에 래퍼 안 링크 이동의 후속 문서도 frameElement를 읽어 매번 재발화한다.
  // 안 막으면 이동마다 frameLoaded가 날아와 사이드패널이 전이 완료 처리를 반복한다.
  it("frameReady + arm 닫힘 → 무발화, documentId만 갱신", () => {
    const res = decideDeviceSignal(
      state({ armed: false, binding: { frameId: 7, documentId: "d1" } }),
      { kind: "frameReady", frameId: 7, documentId: "d2" },
    );
    expect(res.push).toBeNull();
    expect(res.next.binding).toEqual({ frameId: 7, documentId: "d2" });
  });

  it("arm 창 안에서 top의 직속 자식이 top URL로 beforeNavigate하면 잠정 래퍼로 잡는다", () => {
    const res = decideDeviceSignal(state({ armed: true }), {
      kind: "beforeNavigate",
      frameId: 5,
      parentFrameId: 0,
      url: TOP,
    });
    expect(res.push).toBeNull();
    expect(res.next.provisionalFrameId).toBe(5);
  });

  it("arm 창이 닫혀 있으면 top의 자식 커밋을 잠정 래퍼로 잡지 않는다 (일반 iframe 오탐 차단)", () => {
    const res = decideDeviceSignal(state({ armed: false }), {
      kind: "beforeNavigate",
      frameId: 5,
      parentFrameId: 0,
      url: TOP,
    });
    expect(res.push).toBeNull();
    expect(res.next.provisionalFrameId).toBeNull();
  });

  it("2-depth 프레임(parentFrameId≠0)은 잠정 래퍼가 아니다", () => {
    const res = decideDeviceSignal(state({ armed: true }), {
      kind: "beforeNavigate",
      frameId: 9,
      parentFrameId: 5,
      url: TOP,
    });
    expect(res.next.provisionalFrameId).toBeNull();
  });

  it("top URL과 다른 자식 beforeNavigate은 잠정 래퍼가 아니다", () => {
    const res = decideDeviceSignal(state({ armed: true }), {
      kind: "beforeNavigate",
      frameId: 5,
      parentFrameId: 0,
      url: "https://ads.example/banner",
    });
    expect(res.next.provisionalFrameId).toBeNull();
  });
});

describe("decideDeviceSignal — 성공·차단·handoff가 경쟁하지 않는다", () => {
  const armedWithTarget = () => state({ armed: true, provisionalFrameId: 7 });

  it("래퍼 frameId의 same-origin onCommitted → frameLoaded (경로만 바뀐 redirect 포함)", () => {
    const res = decideDeviceSignal(armedWithTarget(), {
      kind: "committed",
      frameId: 7,
      documentId: "d1",
      url: "https://a.com/page?redirected=1",
    });
    expect(res.push).toEqual({ type: "frameLoaded" });
    expect(res.next.binding).toEqual({ frameId: 7, documentId: "d1" });
  });

  it("same-origin redirect가 frameBlocked로 오판되지 않는다", () => {
    const res = decideDeviceSignal(armedWithTarget(), {
      kind: "committed",
      frameId: 7,
      documentId: "d1",
      url: "https://a.com/login",
    });
    expect(res.push).toEqual({ type: "frameLoaded" });
  });

  it("same-origin redirect가 handoff로 오판되지 않는다", () => {
    const res = decideDeviceSignal(armedWithTarget(), {
      kind: "committed",
      frameId: 7,
      documentId: "d1",
      url: "https://a.com/other",
    });
    expect(res.push).not.toEqual(expect.objectContaining({ type: "handoff" }));
  });

  it("래퍼 frameId의 cross-origin onCommitted → handoff (frameLoaded/frameBlocked는 안 나간다)", () => {
    const res = decideDeviceSignal(armedWithTarget(), {
      kind: "committed",
      frameId: 7,
      documentId: "d1",
      url: "https://b.com/",
    });
    expect(res.push).toEqual({ type: "handoff", url: "https://b.com/" });
  });

  // 파티션된 로그아웃 화면이 렌더되기 전에 잡아야 그 문서의 로그·요청이 안 섞인다.
  it("cross-origin은 onBeforeNavigate에서 이미 handoff다 (onCommitted를 안 기다린다)", () => {
    const res = decideDeviceSignal(armedWithTarget(), {
      kind: "beforeNavigate",
      frameId: 7,
      parentFrameId: 0,
      url: "https://b.com/",
    });
    expect(res.push).toEqual({ type: "handoff", url: "https://b.com/" });
  });

  // 판정이 site가 아니라 origin이다 — same-site여도 frameElement가 null이 되고 pre-arm 플래그가 갈린다.
  it("a.com → www.a.com처럼 same-site이면서 cross-origin인 이동도 handoff다", () => {
    const res = decideDeviceSignal(armedWithTarget(), {
      kind: "committed",
      frameId: 7,
      documentId: "d1",
      url: "https://www.a.com/page",
    });
    expect(res.push).toEqual({ type: "handoff", url: "https://www.a.com/page" });
  });

  it("래퍼 frameId의 onErrorOccurred → frameBlocked (진입 시점)", () => {
    const res = decideDeviceSignal(armedWithTarget(), {
      kind: "errorOccurred",
      frameId: 7,
      url: TOP,
    });
    expect(res.push).toEqual({ type: "frameBlocked" });
  });

  it("3초 무신호(armTimeout) → frameBlocked", () => {
    const res = decideDeviceSignal(armedWithTarget(), { kind: "armTimeout" });
    expect(res.push).toEqual({ type: "frameBlocked" });
  });

  // 안 하면 모드 유지 중 래퍼 안 링크로 XFO 사이트에 도달했을 때 백지에 방치된다.
  it("binding 확정 뒤(감시창 밖)의 onErrorOccurred는 handoff 경로로 간다", () => {
    const res = decideDeviceSignal(
      state({ armed: false, binding: { frameId: 7, documentId: "d1" } }),
      { kind: "errorOccurred", frameId: 7, url: "https://blocked.example/" },
    );
    expect(res.push).toEqual({ type: "handoff", url: "https://blocked.example/" });
  });

  it("래퍼가 아닌 프레임의 신호는 전부 무발화다", () => {
    const base = armedWithTarget();
    expect(decideDeviceSignal(base, { kind: "errorOccurred", frameId: 99, url: TOP }).push).toBeNull();
    expect(
      decideDeviceSignal(base, {
        kind: "committed",
        frameId: 99,
        documentId: "x",
        url: "https://b.com/",
      }).push,
    ).toBeNull();
  });

  it("판정 신호 6개가 각각 push 1회 또는 무발화다 (중복 push로 롤백과 활성화가 경쟁하지 않는다)", () => {
    const armed = armedWithTarget();
    const settled = state({ armed: false, binding: { frameId: 7, documentId: "d1" } });
    const signals = [
      [armed, { kind: "frameReady", frameId: 7, documentId: "d1" }, "frameLoaded"],
      [settled, { kind: "frameReady", frameId: 7, documentId: "d2" }, null],
      [armed, { kind: "committed", frameId: 7, documentId: "d1", url: TOP }, "frameLoaded"],
      [armed, { kind: "committed", frameId: 7, documentId: "d1", url: "https://b.com/" }, "handoff"],
      [armed, { kind: "errorOccurred", frameId: 7, url: TOP }, "frameBlocked"],
      [armed, { kind: "armTimeout" }, "frameBlocked"],
    ] as const;
    for (const [s, signal, expected] of signals) {
      const res = decideDeviceSignal(s, signal);
      expect(res.push?.type ?? null, JSON.stringify(signal)).toBe(expected);
    }
  });

  // CSP frame-src가 삽입 자체를 막으면 webNavigation 이벤트가 하나도 안 오고 브라우저가
  // about:blank에 load만 쏜다 — 이게 없으면 3초 타임아웃 말고는 신호가 없다.
  it("arm 창 안에서 래퍼가 about:blank로 load되면 즉시 frameBlocked다", () => {
    const res = decideDeviceSignal(state({ armed: true }), {
      kind: "frameLoadEvent",
      sameOriginHref: "about:blank",
    });
    expect(res.push).toEqual({ type: "frameBlocked" });
  });

  it("load된 문서가 top URL이면 무발화다 (성공을 중복 선언하지 않는다)", () => {
    const res = decideDeviceSignal(state({ armed: true }), {
      kind: "frameLoadEvent",
      sameOriginHref: TOP,
    });
    expect(res.push).toBeNull();
  });

  it("binding이 이미 확정된 뒤의 load는 무발화다", () => {
    const res = decideDeviceSignal(
      state({ armed: true, binding: { frameId: 7, documentId: "d1" } }),
      { kind: "frameLoadEvent", sameOriginHref: "about:blank" },
    );
    expect(res.push).toBeNull();
  });

  it("cross-origin이라 읽을 수 없는 load(null)는 무발화다 — handoff 경로가 따로 잡는다", () => {
    const res = decideDeviceSignal(state({ armed: true }), {
      kind: "frameLoadEvent",
      sameOriginHref: null,
    });
    expect(res.push).toBeNull();
  });

  it("판정이 끝나면 arm 창이 닫힌다 (뒤늦은 타임아웃이 성공을 롤백하지 못한다)", () => {
    const res = decideDeviceSignal(armedWithTarget(), {
      kind: "frameReady",
      frameId: 7,
      documentId: "d1",
    });
    expect(res.next.armed).toBe(false);
  });
});

describe("decideDeviceSignal — 유지 중 same-origin 이동", () => {
  it("frameId는 유지되고 documentId만 교체된다", () => {
    const res = decideDeviceSignal(
      state({ armed: false, binding: { frameId: 7, documentId: "d1" } }),
      { kind: "committed", frameId: 7, documentId: "d2", url: "https://a.com/next" },
    );
    expect(res.next.binding).toEqual({ frameId: 7, documentId: "d2" });
    expect(res.push).toBeNull();
  });
});

describe("isTopLikeFrame", () => {
  // 모드 OFF에서 기존 동작 100% 보존 — prd 목표 6의 유일한 유닛 그물이다.
  it("모드 OFF(binding 없음)에서 frameId === 0과 동치다", () => {
    for (const frameId of [0, 1, 5, 99]) {
      expect(isTopLikeFrame(null, frameId)).toBe(frameId === 0);
    }
  });

  it("모드 ON에서 top과 래퍼 둘 다 true, 그 외는 false", () => {
    const binding = { frameId: 7, documentId: "d1" };
    expect(isTopLikeFrame(binding, 0)).toBe(true);
    expect(isTopLikeFrame(binding, 7)).toBe(true);
    expect(isTopLikeFrame(binding, 8)).toBe(false);
  });
});

describe("splitTabDocuments", () => {
  const frames = [
    { frameId: 0, parentFrameId: -1, documentId: "top" },
    { frameId: 7, parentFrameId: 0, documentId: "wrap" },
    { frameId: 9, parentFrameId: 7, documentId: "wrapChild" },
    { frameId: 3, parentFrameId: 0, documentId: "ad" },
  ];

  it("모드 OFF에서 deviceTree가 빈 배열이다 (게이트가 기존 broadcast 경로로 떨어지는 조건)", () => {
    const res = splitTabDocuments(frames, null);
    expect(res.deviceTree).toEqual([]);
    expect(res.all).toEqual(["top", "wrap", "wrapChild", "ad"]);
  });

  it("래퍼와 그 자손만 deviceTree에 든다", () => {
    const res = splitTabDocuments(frames, { frameId: 7, documentId: "wrap" });
    expect(res.deviceTree.sort()).toEqual(["wrap", "wrapChild"]);
    expect(res.all).toContain("top");
    expect(res.all).toContain("ad");
  });

  it("documentId가 없는 프레임은 열거에서 빠진다", () => {
    const res = splitTabDocuments([{ frameId: 0, parentFrameId: -1 }], null);
    expect(res.all).toEqual([]);
  });
});

describe("SW 재기동 복원", () => {
  const store: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.resetModules();
    vi.stubGlobal("chrome", {
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (obj: Record<string, unknown>) => {
            Object.assign(store, obj);
          }),
          remove: vi.fn(async (key: string) => {
            delete store[key];
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("setDeviceFrame이 storage.session에 권위값을 보존한다", async () => {
    const mod = await import("../device-frame-coordinator");
    await mod.setDeviceFrame(1, { frameId: 7, documentId: "d1" });
    expect(Object.values(store)).toContainEqual({ frameId: 7, documentId: "d1" });
  });

  // 복구 전 이벤트를 동기 기본값으로 판정하면 래퍼를 top-only로 오판한다.
  it("복원 뒤 큐 안에서 조회하면 래퍼를 다시 인식한다", async () => {
    const first = await import("../device-frame-coordinator");
    await first.setDeviceFrame(1, { frameId: 7, documentId: "d1" });

    vi.resetModules();
    const revived = await import("../device-frame-coordinator");
    const seen = await revived.enqueueForTab(1, () =>
      revived.isTopLikeFrame(revived.getDeviceFrame(1), 7),
    );
    expect(seen).toBe(true);
  });

  it("탭별 순서 큐가 등록 순서를 보존한다", async () => {
    const mod = await import("../device-frame-coordinator");
    const order: number[] = [];
    await Promise.all([
      mod.enqueueForTab(1, async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      }),
      mod.enqueueForTab(1, () => {
        order.push(2);
      }),
      mod.enqueueForTab(1, () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("binding 해제 시 storage에서도 지워진다", async () => {
    const mod = await import("../device-frame-coordinator");
    await mod.setDeviceFrame(1, { frameId: 7, documentId: "d1" });
    await mod.setDeviceFrame(1, null);
    expect(mod.getDeviceFrame(1)).toBeNull();
    expect(Object.values(store)).not.toContainEqual({ frameId: 7, documentId: "d1" });
  });
});
