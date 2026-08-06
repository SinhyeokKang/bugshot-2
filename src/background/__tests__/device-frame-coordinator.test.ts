import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideDeviceSignal,
  handoffDeviceTab,
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

  // 래퍼 자가식별은 frameElement.id 하나뿐인데 그 id는 페이지가 붙이는 DOM 속성이고,
  // picker는 all_frames라 페이지가 만든 same-origin iframe에도 주입돼 정상적으로 frameReady를
  // 쏜다. 무조건 수용하면 위조 binding이 굳고, sentinel 게이트의 모드 판정이 deviceTree 길이라
  // 사용자가 모드를 켠 적 없어도 ON으로 뒤집혀 진짜 top의 로그가 통째로 안 잡힌다.
  it("arm 닫힘 + binding 없음이면 frameReady를 아예 수용하지 않는다", () => {
    const res = decideDeviceSignal(state({ armed: false, binding: null }), {
      kind: "frameReady",
      frameId: 9,
      documentId: "forged",
    });
    expect(res.push).toBeNull();
    expect(res.next.binding).toBeNull();
  });

  it("arm 열림 + provisional 없음면 직속 iframe의 frameReady도 수용하지 않는다", () => {
    const res = decideDeviceSignal(
      state({ armed: true, provisionalFrameId: null, binding: null }),
      { kind: "frameReady", frameId: 9, documentId: "forged" },
    );
    expect(res.push).toBeNull();
    expect(res.next.binding).toBeNull();
    expect(res.next.armed).toBe(true);
  });

  it("arm 닫힘에서 다른 frameId의 frameReady는 확정 binding을 못 가로챈다", () => {
    const res = decideDeviceSignal(
      state({ armed: false, binding: { frameId: 7, documentId: "d1" } }),
      { kind: "frameReady", frameId: 9, documentId: "forged" },
    );
    expect(res.next.binding).toEqual({ frameId: 7, documentId: "d1" });
  });

  it("arm 열림이어도 잠정 래퍼와 다른 frameId면 승격하지 않는다", () => {
    const res = decideDeviceSignal(state({ armed: true, provisionalFrameId: 7 }), {
      kind: "frameReady",
      frameId: 9,
      documentId: "forged",
    });
    expect(res.push).toBeNull();
    expect(res.next.binding).toBeNull();
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


  it("판정이 끝나면 arm 창이 닫힌다 (뒤늦은 타임아웃이 성공을 롤백하지 못한다)", () => {
    const res = decideDeviceSignal(armedWithTarget(), {
      kind: "frameReady",
      frameId: 7,
      documentId: "d1",
    });
    expect(res.next.armed).toBe(false);
  });

  it("beforeNavigate handoff 뒤 같은 프레임의 committed가 handoff를 중복 발화하지 않는다", () => {
    const first = decideDeviceSignal(
      state({ armed: false, binding: { frameId: 7, documentId: "d1" } }),
      { kind: "beforeNavigate", frameId: 7, parentFrameId: 0, url: "https://b.com/" },
    );
    const second = decideDeviceSignal(first.next, {
      kind: "committed",
      frameId: 7,
      documentId: "d2",
      url: "https://b.com/",
    });

    expect(first.push).toEqual({ type: "handoff", url: "https://b.com/" });
    expect(first.next.binding).toBeNull();
    expect(second.push).toBeNull();
  });
});

describe("handoffDeviceTab — 패널 수명과 무관한 top 이동", () => {
  it("패널 ACK 후 top을 이동한다", async () => {
    const order: string[] = [];
    await handoffDeviceTab(
      1,
      "https://b.com/",
      async () => { order.push("notify"); },
      async () => { order.push("update"); },
    );
    expect(order).toEqual(["notify", "update"]);
  });

  it("패널 수신자가 없어도 top을 이동한다", async () => {
    const update = vi.fn(async () => {});
    await handoffDeviceTab(
      1,
      "https://b.com/",
      async () => { throw new Error("no receiver"); },
      update,
    );
    expect(update).toHaveBeenCalledWith(1, "https://b.com/");
  });

  it("패널 ACK가 안 오면 상한 후 top을 이동한다", async () => {
    const update = vi.fn(async () => {});
    await handoffDeviceTab(1, "https://b.com/", () => new Promise(() => {}), update, vi.fn(), 1);
    expect(update).toHaveBeenCalledWith(1, "https://b.com/");
  });

  it("unsupported URL은 top 이동 대신 Full 안전 강등을 실행한다", async () => {
    const update = vi.fn(async () => {});
    const rollback = vi.fn(async () => {});
    await handoffDeviceTab(1, "blob:https://a.com/id", async () => {}, update, rollback);
    expect(update).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledWith(1);
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
  const url = "https://a.com/";
  const frames = [
    { frameId: 0, parentFrameId: -1, documentId: "top", url },
    { frameId: 7, parentFrameId: 0, documentId: "wrap", url },
    { frameId: 9, parentFrameId: 7, documentId: "wrapChild", url },
    { frameId: 3, parentFrameId: 0, documentId: "ad", url },
  ];

  // manifest에 match_about_blank가 없어 about:blank·srcdoc 프레임엔 레코더가 안 붙는다.
  // 열거에 남겨두면 stop ACK가 "Receiving end does not exist"로 거절돼, 광고 iframe 하나로
  // 정상 로드된 래퍼까지 롤백된다.
  it("content script가 못 붙는 프레임은 열거에서 뺀다", () => {
    const withBlank = [
      ...frames,
      { frameId: 4, parentFrameId: 0, documentId: "blank", url: "about:blank" },
      { frameId: 5, parentFrameId: 0, documentId: "srcdoc", url: "about:srcdoc" },
      { frameId: 6, parentFrameId: 0, documentId: "data", url: "data:text/html,x" },
    ];
    const res = splitTabDocuments(withBlank, null);
    expect(res.all).not.toContain("blank");
    expect(res.all).not.toContain("srcdoc");
    expect(res.all).not.toContain("data");
    expect(res.all).toContain("top");
  });

  // 커밋 직후의 getAllFrames는 래퍼 URL을 아직 about:blank로 보고할 때가 있다. 그걸 필터로
  // 떨어뜨리면 deviceTree가 비어 활성화가 실패하고, 정상 로드된 래퍼가 롤백된다.
  // binding이 존재한다는 것 자체가 "그 프레임에 스크립트가 살아 있다"는 증거다.
  it("래퍼 자신은 URL이 아직 안 잡혀도 deviceTree에 남는다", () => {
    const res = splitTabDocuments(
      [
        { frameId: 0, parentFrameId: -1, documentId: "top", url },
        { frameId: 7, parentFrameId: 0, documentId: "wrap", url: "about:blank" },
      ],
      { frameId: 7, documentId: "wrap" },
    );
    expect(res.deviceTree).toEqual(["wrap"]);
  });

  // getAllFrames가 방금 커밋된 래퍼를 아직 목록에 안 싣는 창이 있다. 그걸 그대로 두면
  // deviceTree가 비어 활성화가 실패하고 정상 로드된 래퍼가 롤백된다 — binding의 documentId는
  // 커밋·frameReady에서 이미 받은 값이라 진입 감시창 안에서는 열거를 기다릴 이유가 없다.
  it("진입 감시창 안에서는 열거가 늦어도 binding의 documentId가 deviceTree에 든다", () => {
    const res = splitTabDocuments(
      [{ frameId: 0, parentFrameId: -1, documentId: "top", url }],
      { frameId: 7, documentId: "wrap" },
      { armed: true },
    );
    expect(res.deviceTree).toEqual(["wrap"]);
  });

  // 창 밖에서까지 넣으면, 페이지 JS가 래퍼를 지웠는데 top 커밋이 없는 경우(binding은 top
  // 커밋에서만 소거된다) 게이트가 영구히 "모드 ON"으로 굳어 죽은 documentId로만 발행한다 =
  // 탭 세션 내내 로그 전면 공백. 창 밖에선 비워서 기존 broadcast 폴백으로 자가복구시킨다.
  it("감시창 밖에서 열거에 없으면 deviceTree를 비워 broadcast 폴백으로 떨어뜨린다", () => {
    const res = splitTabDocuments(
      [{ frameId: 0, parentFrameId: -1, documentId: "top", url }],
      { frameId: 7, documentId: "wrap" },
    );
    expect(res.deviceTree).toEqual([]);
  });

  it("열거에 이미 있으면 중복으로 넣지 않는다", () => {
    const res = splitTabDocuments(frames, { frameId: 7, documentId: "wrap" }, { armed: true });
    expect(res.deviceTree.filter((d) => d === "wrap")).toHaveLength(1);
  });

  it("주입 불가 프레임은 래퍼 자손이어도 deviceTree에서 빠진다", () => {
    const withBlank = [
      ...frames,
      { frameId: 8, parentFrameId: 7, documentId: "wrapBlank", url: "about:blank" },
    ];
    const res = splitTabDocuments(withBlank, { frameId: 7, documentId: "wrap" });
    expect(res.deviceTree).not.toContain("wrapBlank");
    expect(res.deviceTree.sort()).toEqual(["wrap", "wrapChild"]);
  });

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
    const res = splitTabDocuments([{ frameId: 0, parentFrameId: -1, url }], null);
    expect(res.all).toEqual([]);
  });
});

describe("SW 재기동 복원", () => {
  const store: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.resetModules();
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: vi.fn(async () => ({ ok: true })) },
      tabs: {
        update: vi.fn(async () => ({})),
        sendMessage: vi.fn(async () => ({})),
        reload: vi.fn(async () => {}),
      },
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

  it("binding storage 삭제가 실패해도 handoff top 이동은 계속한다", async () => {
    const mod = await import("../device-frame-coordinator");
    await mod.setDeviceFrame(1, { frameId: 7, documentId: "d1" });
    vi.mocked(chrome.storage.session.remove).mockRejectedValueOnce(new Error("storage unavailable"));
    mod.armDeviceFrame(1, false, TOP);

    await mod.applyDeviceSignal(1, {
      kind: "beforeNavigate",
      frameId: 7,
      parentFrameId: 0,
      url: "https://b.com/",
    });

    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: "https://b.com/" });
  });
});
