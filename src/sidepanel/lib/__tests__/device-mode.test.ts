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
  // 복원 지시는 action 자체가 나른다 — 소비처가 안 읽는 별도 플래그를 두지 않는다.
  it("busy면 거부한다 (소비한 pending은 호출부가 되돌려놓는다)", () => {
    expect(decideReestablish({ unsupported: false, busy: true })).toEqual({
      action: "reject",
      reason: "busy",
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
    expect(takePending(1)).toBe(390);
    expect(peekPending(1)).toBeNull();
  });

  it("takePending은 소비 즉시 삭제한다 (실패 경로에 유령 pending이 안 남는다)", () => {
    putPending(1, 390);
    expect(takePending(1)).toBe(390);
    expect(takePending(1)).toBeNull();
  });

  it("busy 거부 시 되돌려놓을 수 있다", () => {
    putPending(1, 390);
    const width = takePending(1)!;
    putPending(1, width);
    expect(peekPending(1)).toBe(390);
  });

  it("폐기는 탭 단위다 (다른 탭 pending을 안 건드린다)", () => {
    putPending(1, 390);
    putPending(2, 768);
    dropPending(1);
    expect(peekPending(1)).toBeNull();
    expect(peekPending(2)).toBe(768);
  });
});

// 판정 축은 **횟수 하나**다 — URL을 인자로 받지 않는 것 자체가 그 계약이다. 그래서
// "같은 URL 재수립"·"a→b→a 핑퐁"·"handoff 없는 재수립"을 별도 케이스로 쓸 수 없다(호출열이
// 같아 이름만 다른 사본이 된다). 시나리오 구분이 필요해지면 인자를 되살리는 게 먼저다.
describe("루프 가드 — handoff가 아니라 재수립을 센다", () => {
  // 2회까지 통과하는 게 요점이다 — 10초 안의 평범한 재새로고침 두 번이 여기 걸리면
  // 모드 해제 + editor reset(작성 중 draft 파기)이 정상 사용에서 터진다.
  it("연속 2회까지는 통과하고 3회째에 루프로 판정한다", () => {
    expect(noteReestablish(1)).toBe("ok");
    expect(noteReestablish(1)).toBe("ok");
    expect(noteReestablish(1)).toBe("loop");
  });

  // 래퍼가 window.top.location으로 탈출하면 handoff를 거치지 않고 top이 곧장 커밋된다.
  // 카운터를 이 호출 하나에 걸어야 그 경로가 같은 그물에 들어온다 — 별도 축이 없다.
  it("임계를 넘긴 뒤로는 계속 루프로 판정한다", () => {
    noteReestablish(1);
    noteReestablish(1);
    expect(noteReestablish(1)).toBe("loop");
    expect(noteReestablish(1)).toBe("loop");
  });

  it("사용자의 명시적 세그먼트 조작이면 카운터가 0이다", () => {
    noteReestablish(1);
    noteReestablish(1);
    resetLoopGuard(1);
    expect(noteReestablish(1)).toBe("ok");
  });

  it("재수립 성공 후 top 커밋 없이 10초가 지나면 카운터가 0이다", () => {
    vi.useFakeTimers();
    try {
      noteReestablish(1);
      noteReestablish(1);
      vi.advanceTimersByTime(LOOP_RESET_MS + 1);
      expect(noteReestablish(1)).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("카운터가 탭별로 분리된다", () => {
    noteReestablish(1);
    noteReestablish(1);
    expect(noteReestablish(2)).toBe("ok");
  });
});
