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

// phase 축은 여기 인자가 아니다 — 이 함수가 phase를 아예 안 받는 것이 곧 "재수립은 phase로
// 막지 않는다"는 계약이다. 인자로 받아놓고 안 읽으면 그 계약을 검증하는 테스트가 공허해진다.
// 실제 우회 여부는 컨트롤러 테스트(device-viewport-controller.test.ts)가 잡는다.
describe("decideReestablish — 폐기·거부 축", () => {
  // locked가 phase !== "idle" || unsupported 두 축이라 뭉뚱그리면 미지원 URL에서도
  // 재수립을 시도한다. 폐기 조건이 이긴다.
  it("unsupported면 폐기한다", () => {
    expect(decideReestablish({ unsupported: true, busy: false })).toEqual({
      action: "abandon",
      reason: "unsupported",
    });
  });

  // 삭제한 채 거부하면 select()가 도는 중에 온 top 커밋에서 모드가 조용히 유실된다.
  it("busy면 거부하되 소비한 pending을 복원하라고 지시한다", () => {
    expect(decideReestablish({ unsupported: false, busy: true })).toEqual({
      action: "reject",
      reason: "busy",
      restorePending: true,
    });
  });

  it("unsupported가 busy보다 먼저 판정된다 (폐기 우선)", () => {
    expect(decideReestablish({ unsupported: true, busy: true })).toEqual({
      action: "abandon",
      reason: "unsupported",
    });
  });

  it("둘 다 아니면 실행한다", () => {
    expect(decideReestablish({ unsupported: false, busy: false })).toEqual({ action: "run" });
  });
});

describe("pending — 모듈 스코프 단일 인스턴스", () => {
  // 소비가 파괴적이라 두 번째 독자는 빈손이 된다 — 이게 "top 커밋 한 번에 재수립 1회"를
  // 보장하는 실제 장치다(상태를 훅에 두면 인스턴스마다 사본을 갖게 돼 이 성질이 깨진다).
  it("두 번째 소비자는 빈손이다", () => {
    putPending(1, 390);
    expect(takePending(1)).toEqual({ tabId: 1, width: 390 });
    expect(peekPending(1)).toBeNull();
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
