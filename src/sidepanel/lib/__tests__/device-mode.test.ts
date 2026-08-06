import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOOP_RESET_MS,
  decideReestablish,
  dropPending,
  clearDeviceModeState,
  noteReestablish,
  peekPending,
  putPending,
  resetLoopGuard,
  resolveSelectPath,
  takePending,
} from "../device-mode";

beforeEach(() => {
  clearDeviceModeState();
});

describe("resolveSelectPath — select()가 세 경로로 갈린다", () => {
  it("전체 → 폭은 OFF→ON 전체 순서를 탄다", () => {
    expect(resolveSelectPath(null, 390)).toBe("off-to-on");
  });

  // 재로드가 없어 frameReady도 onCommitted도 안 온다 — arm·frameLoaded 대기를 붙이면
  // 3초 무신호 → 차단 판정 → 롤백으로 390에서 768을 누를 때 모드가 통째로 풀린다.
  it("폭 → 다른 폭은 device.set 하나로 끝나는 경량 경로다", () => {
    expect(resolveSelectPath(390, 768)).toBe("resize");
  });

  it("폭 → 전체는 unmount + reload 경로다", () => {
    expect(resolveSelectPath(390, null)).toBe("on-to-off");
  });

  it("같은 값 재선택은 아무것도 하지 않는다", () => {
    expect(resolveSelectPath(390, 390)).toBe("noop");
    expect(resolveSelectPath(null, null)).toBe("noop");
  });
});

describe("decideReestablish — 계약의 잠금 축", () => {
  // 이 태스크의 존재 이유. 거부하면 drafting·recording 중 handoff에서 top만 옮겨가고
  // 래퍼가 안 서는데 세그먼트는 390을 가리키는 desync가 된다.
  it("phase 축(locked)을 우회한다 — drafting·recording에서도 실행된다", () => {
    for (const phase of ["drafting", "styling", "recording", "previewing", "capturing"]) {
      expect(
        decideReestablish({ phase, unsupported: false, busy: false, loop: false }),
      ).toEqual({ action: "run" });
    }
  });

  // locked가 phase !== "idle" || unsupported 두 축이라 뭉뚱그리면 미지원 URL에서도
  // 재수립을 시도한다. 폐기 조건이 이긴다.
  it("unsupported는 우회하지 않는다 — 폐기가 이긴다", () => {
    expect(
      decideReestablish({ phase: "idle", unsupported: true, busy: false, loop: false }),
    ).toEqual({ action: "abandon", reason: "unsupported" });
  });

  // 삭제한 채 거부하면 select()가 도는 중에 온 top 커밋에서 모드가 조용히 유실된다.
  it("busy면 거부하되 소비한 pending을 복원하라고 지시한다", () => {
    expect(
      decideReestablish({ phase: "idle", unsupported: false, busy: true, loop: false }),
    ).toEqual({ action: "reject", reason: "busy", restorePending: true });
  });

  it("루프 임계 초과면 폐기한다", () => {
    expect(
      decideReestablish({ phase: "drafting", unsupported: false, busy: false, loop: true }),
    ).toEqual({ action: "abandon", reason: "loop" });
  });

  it("unsupported가 busy·loop보다 먼저 판정된다 (폐기 우선)", () => {
    expect(
      decideReestablish({ phase: "idle", unsupported: true, busy: true, loop: true }),
    ).toEqual({ action: "abandon", reason: "unsupported" });
  });
});

describe("pending — 모듈 스코프 단일 인스턴스", () => {
  // 훅이 DeviceViewportBar와 App.tsx 다이얼로그 분기에서 두 번 마운트되므로, 훅 상태에 두면
  // top 커밋 한 번에 재수립이 2회 발사되고 루프 임계를 각각 절반씩 센다.
  it("어느 import 경로에서 읽어도 같은 인스턴스다", async () => {
    putPending(1, 390);
    const again = await import("../device-mode");
    expect(again.peekPending(1)).toEqual({ tabId: 1, width: 390 });
  });

  it("takePending은 소비 즉시 삭제한다 (실패 경로에 유령 pending이 안 남는다)", () => {
    putPending(1, 390);
    expect(takePending(1)).toEqual({ tabId: 1, width: 390 });
    expect(takePending(1)).toBeNull();
  });

  it("busy 거부 시 되돌려놓을 수 있다", () => {
    putPending(1, 390);
    const consumed = takePending(1)!;
    putPending(consumed.tabId, consumed.width);
    expect(peekPending(1)).toEqual({ tabId: 1, width: 390 });
  });

  it("폐기는 탭 단위다 (다른 탭 pending을 안 건드린다)", () => {
    putPending(1, 390);
    putPending(2, 768);
    dropPending(1);
    expect(peekPending(1)).toBeNull();
    expect(peekPending(2)).toEqual({ tabId: 2, width: 768 });
  });
});

describe("루프 가드 — handoff가 아니라 재수립을 센다", () => {
  it("연속 2회까지는 통과하고 3회째에 루프로 판정한다", () => {
    expect(noteReestablish(1, "https://a.com/")).toBe("ok");
    expect(noteReestablish(1, "https://b.com/")).toBe("ok");
    expect(noteReestablish(1, "https://c.com/")).toBe("loop");
  });

  // 래퍼가 window.top.location으로 탈출하면 handoff를 거치지 않고 top이 곧장 커밋된다.
  // 카운터를 reestablish 호출에 걸어야 그 경로가 한 그물에 들어온다.
  it("handoff를 거치지 않은 재수립도 같은 카운터를 올린다", () => {
    // 호출 지점이 무엇이든 noteReestablish 하나만 센다 — 별도 축이 없다.
    noteReestablish(1, "https://a.com/");
    noteReestablish(1, "https://a.com/");
    expect(noteReestablish(1, "https://a.com/")).toBe("loop");
  });

  it("직전 재수립 URL 재방문이면 횟수와 무관하게 루프다", () => {
    expect(noteReestablish(1, "https://a.com/")).toBe("ok");
    expect(noteReestablish(1, "https://a.com/")).toBe("loop");
  });

  it("사용자의 명시적 세그먼트 조작이면 카운터가 0이다", () => {
    noteReestablish(1, "https://a.com/");
    noteReestablish(1, "https://b.com/");
    resetLoopGuard(1);
    expect(noteReestablish(1, "https://c.com/")).toBe("ok");
  });

  it("재수립 성공 후 top 커밋 없이 10초가 지나면 카운터가 0이다", () => {
    vi.useFakeTimers();
    try {
      noteReestablish(1, "https://a.com/");
      noteReestablish(1, "https://b.com/");
      vi.advanceTimersByTime(LOOP_RESET_MS + 1);
      expect(noteReestablish(1, "https://c.com/")).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("카운터가 탭별로 분리된다", () => {
    noteReestablish(1, "https://a.com/");
    noteReestablish(1, "https://b.com/");
    expect(noteReestablish(2, "https://c.com/")).toBe("ok");
  });
});
