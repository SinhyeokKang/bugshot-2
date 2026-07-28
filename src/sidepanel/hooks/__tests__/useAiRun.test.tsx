import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useAiRun } from "../useAiRun";
import type { AiRun, AiRunKind } from "../useAiRun";

// 슬롯을 실제 store처럼 흉내낸다 — 헬퍼는 setter로 쓰고 getter로 읽어
// "지금 슬롯에 있는 게 내가 등록한 canceller인가"를 판정한다(규약 5).
function setup(kind: AiRunKind) {
  let slot: (() => void) | null = null;
  const setAiCancel = vi.fn((fn: (() => void) | null) => {
    slot = fn;
  });
  const getAiCancel = () => slot;
  const setLoading = vi.fn();
  const onDispose = vi.fn();

  const view = renderHook(() =>
    useAiRun({ kind, setLoading, setAiCancel, onDispose, getAiCancel }),
  );

  return {
    ...view,
    setLoading,
    setAiCancel,
    onDispose,
    slotRef: {
      get current() {
        return slot;
      },
      set current(fn: (() => void) | null) {
        slot = fn;
      },
    },
  };
}

function begin(view: ReturnType<typeof setup>): AiRun {
  let run!: AiRun;
  act(() => {
    run = view.result.current.begin();
  });
  return run;
}

describe("useAiRun", () => {
  describe("begin / end 기본", () => {
    it("begin()이 로딩을 켜고 canceller를 슬롯에 등록한다", () => {
      const v = setup("oneshot");
      begin(v);

      expect(v.setLoading).toHaveBeenCalledWith(true);
      expect(v.setAiCancel).toHaveBeenCalledTimes(1);
      expect(typeof v.slotRef.current).toBe("function");
    });

    it("begin() 직후 isActive는 true, end() 후 로딩이 꺼지고 슬롯이 비워진다", () => {
      const v = setup("oneshot");
      const run = begin(v);

      expect(v.result.current.isActive(run)).toBe(true);

      act(() => v.result.current.end(run));

      expect(v.setLoading).toHaveBeenLastCalledWith(false);
      expect(v.setAiCancel).toHaveBeenLastCalledWith(null);
      expect(v.slotRef.current).toBeNull();
      expect(v.result.current.isActive(run)).toBe(false);
    });
  });

  describe("stale run 차단", () => {
    it("두 번째 begin() 후 첫 run은 isActive가 false다", () => {
      const v = setup("oneshot");
      const first = begin(v);
      const second = begin(v);

      expect(v.result.current.isActive(first)).toBe(false);
      expect(v.result.current.isActive(second)).toBe(true);
    });

    it("stale run의 end()는 새 run의 로딩을 끄지 않는다", () => {
      const v = setup("oneshot");
      const first = begin(v);
      begin(v);
      v.setLoading.mockClear();

      act(() => v.result.current.end(first));

      expect(v.setLoading).not.toHaveBeenCalled();
      expect(v.slotRef.current).not.toBeNull();
    });
  });

  describe("canceller (오버레이 '중단')", () => {
    it("canceller가 signal을 abort하고 onDispose를 부르고 로딩을 끈다", () => {
      const v = setup("oneshot");
      const run = begin(v);
      const cancel = v.slotRef.current!;

      act(() => cancel());

      expect(run.signal.aborted).toBe(true);
      expect(v.onDispose).toHaveBeenCalledTimes(1);
      expect(v.setLoading).toHaveBeenLastCalledWith(false);
      expect(v.result.current.isActive(run)).toBe(false);
    });

    it("resumable도 사용자 중단에서는 abort한다", () => {
      const v = setup("resumable");
      const run = begin(v);

      act(() => v.slotRef.current!());

      expect(run.signal.aborted).toBe(true);
    });
  });

  describe("detach — kind가 abort를 결정한다 (규약 4)", () => {
    it("oneshot의 detach는 signal을 abort한다", () => {
      const v = setup("oneshot");
      const run = begin(v);

      act(() => v.result.current.detach(run));

      expect(run.signal.aborted).toBe(true);
    });

    // 2026-07-28 회귀 가드 — 여기서 abort하면 재개될 요청을 죽인다.
    it("resumable의 detach는 signal을 abort하지 않는다", () => {
      const v = setup("resumable");
      const run = begin(v);

      act(() => v.result.current.detach(run));

      expect(run.signal.aborted).toBe(false);
    });

    it("detach는 store를 건드리지 않는다 — 중단 버튼과 스피너가 유지된다", () => {
      const v = setup("resumable");
      const run = begin(v);
      v.setLoading.mockClear();
      v.setAiCancel.mockClear();

      act(() => v.result.current.detach(run));

      expect(v.setLoading).not.toHaveBeenCalled();
      expect(v.setAiCancel).not.toHaveBeenCalled();
      expect(v.slotRef.current).not.toBeNull();
    });

    it("detach된 run도 여전히 현재 run이므로 end()가 로딩을 끈다", () => {
      const v = setup("resumable");
      const run = begin(v);
      act(() => v.result.current.detach(run));
      v.setLoading.mockClear();

      act(() => v.result.current.end(run));

      expect(v.setLoading).toHaveBeenCalledWith(false);
      expect(v.slotRef.current).toBeNull();
    });

    it("detach된 run은 isActive가 false다", () => {
      const v = setup("resumable");
      const run = begin(v);

      act(() => v.result.current.detach(run));

      expect(v.result.current.isActive(run)).toBe(false);
    });
  });

  describe("readopt — 게이트 왕복 재개", () => {
    it("detach 후 readopt()가 같은 run을 되살린다", () => {
      const v = setup("resumable");
      const run = begin(v);
      act(() => v.result.current.detach(run));

      let revived: AiRun | null = null;
      act(() => {
        revived = v.result.current.readopt();
      });

      expect(revived).toBe(run);
      expect(v.result.current.isActive(run)).toBe(true);
      expect(run.signal.aborted).toBe(false);
    });

    it("사용자가 중단한 run은 readopt()가 되살리지 않는다", () => {
      const v = setup("resumable");
      begin(v);
      act(() => v.slotRef.current!());

      let revived: AiRun | null = null;
      act(() => {
        revived = v.result.current.readopt();
      });

      expect(revived).toBeNull();
    });

    it("begin()이 교체한 run은 readopt() 대상이 아니다", () => {
      const v = setup("resumable");
      const first = begin(v);
      const second = begin(v);
      act(() => v.result.current.detach(second));

      let revived: AiRun | null = null;
      act(() => {
        revived = v.result.current.readopt();
      });

      expect(revived).toBe(second);
      expect(revived).not.toBe(first);
    });
  });

  describe("begin()의 교체 규칙 (규약 1·2·3)", () => {
    // 세션 재사용이 여기 의존한다 — 정상 종료한 run까지 dispose하면
    // AiStylingDialog의 멀티턴 대화가 매 제출마다 소실된다.
    it("end() 후의 begin()은 onDispose를 부르지 않는다", () => {
      const v = setup("oneshot");
      const run = begin(v);
      act(() => v.result.current.end(run));
      v.onDispose.mockClear();

      begin(v);

      expect(v.onDispose).not.toHaveBeenCalled();
    });

    it("미종료 run이 있으면 begin()이 onDispose를 정확히 1회 부르고 새 canceller를 등록한다", () => {
      const v = setup("oneshot");
      begin(v);
      const firstCanceller = v.slotRef.current;
      v.onDispose.mockClear();

      begin(v);

      expect(v.onDispose).toHaveBeenCalledTimes(1);
      expect(v.slotRef.current).not.toBe(firstCanceller);
      expect(typeof v.slotRef.current).toBe("function");
    });

    it.each<AiRunKind>(["oneshot", "resumable"])(
      "%s: 교체된 run은 abort된다 — 아무도 이어받지 않는 요청을 살려두지 않는다",
      (kind) => {
        const v = setup(kind);
        const first = begin(v);

        begin(v);

        expect(first.signal.aborted).toBe(true);
      },
    );

    // StyleCssView가 aiStylingLoading의 true→false 하강 에지를 "AI 턴 종료"로
    // 읽어 CodeMirror doc을 강행 재동기화한다 — 교체가 그 에지를 만들면
    // 포커스 중 에디터가 덮어써진다(2026-07-08).
    it("교체 중 로딩을 false로 내리지 않는다", () => {
      const v = setup("oneshot");
      begin(v);
      begin(v);

      expect(v.setLoading).not.toHaveBeenCalledWith(false);
    });
  });

  describe("슬롯 소유권 (규약 5 — crossover 방지)", () => {
    it("슬롯이 남의 canceller면 end()가 비우지 않는다", () => {
      const v = setup("oneshot");
      const run = begin(v);

      // 다른 surface가 그 사이 자기 canceller를 등록한 상황.
      const other = vi.fn();
      v.slotRef.current = other;
      v.setAiCancel.mockClear();

      act(() => v.result.current.end(run));

      expect(v.setAiCancel).not.toHaveBeenCalled();
      expect(v.slotRef.current).toBe(other);
    });

    it("슬롯이 남의 canceller여도 자기 로딩은 끈다", () => {
      const v = setup("oneshot");
      const run = begin(v);
      v.slotRef.current = vi.fn();
      v.setLoading.mockClear();

      act(() => v.result.current.end(run));

      expect(v.setLoading).toHaveBeenCalledWith(false);
    });
  });

  describe("참조 안정성 (규약 6)", () => {
    it("rerender 후에도 컨트롤러와 5개 메서드의 참조가 같다", () => {
      const v = setup("oneshot");
      const before = v.result.current;

      v.rerender();

      const after = v.result.current;
      expect(after).toBe(before);
      expect(after.begin).toBe(before.begin);
      expect(after.isActive).toBe(before.isActive);
      expect(after.end).toBe(before.end);
      expect(after.readopt).toBe(before.readopt);
      expect(after.detach).toBe(before.detach);
    });
  });

  describe("언마운트", () => {
    it("oneshot 언마운트는 abort하고 로딩·슬롯·세션을 정리한다", () => {
      const v = setup("oneshot");
      const run = begin(v);
      v.setLoading.mockClear();

      v.unmount();

      expect(run.signal.aborted).toBe(true);
      expect(v.setLoading).toHaveBeenCalledWith(false);
      expect(v.setAiCancel).toHaveBeenLastCalledWith(null);
      expect(v.onDispose).toHaveBeenCalledTimes(1);
    });

    // resumable의 cleanup은 콜사이트 detach가 담당한다 — 여기서 abort하면
    // 게이트 왕복이 재개될 요청을 죽인다.
    it("resumable 언마운트는 abort하지 않는다", () => {
      const v = setup("resumable");
      const run = begin(v);

      v.unmount();

      expect(run.signal.aborted).toBe(false);
    });

    it("진행 중 run이 없으면 언마운트가 store를 건드리지 않는다", () => {
      const v = setup("oneshot");
      v.setLoading.mockClear();
      v.setAiCancel.mockClear();

      v.unmount();

      expect(v.setLoading).not.toHaveBeenCalled();
      expect(v.setAiCancel).not.toHaveBeenCalled();
    });
  });
});
