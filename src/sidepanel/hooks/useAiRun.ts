import { useCallback, useEffect, useMemo, useRef } from "react";

// oneshot: 사용자 액션이 시작한다. effect cleanup = 이 run은 끝났다 → abort해도 안전.
// resumable: effect가 자동 발화한다. cleanup은 언마운트와 deps 변경을 구분하지 못하므로
//            abort하면 재개될 요청을 죽인다 → cleanup에서 abort하지 않는다(POSTMORTEM 2026-07-28).
export type AiRunKind = "oneshot" | "resumable";

// 콜사이트에는 signal만 노출한다 — 취소 플래그를 직접 만지는 순간 레인이 다시 갈린다.
export interface AiRun {
  readonly signal: AbortSignal;
}

interface AiRunInternal extends AiRun {
  cancelled: boolean;
  userCancelled: boolean;
  disposed: boolean;
  readonly controller: AbortController;
}

export interface AiRunController {
  /** 새 run 시작. 아직 종료되지 않은 직전 run이 있으면 취소·onDispose 후 교체한다. */
  begin(): AiRun;
  /** await 재개 지점의 단일 술어. */
  isActive(run: AiRun): boolean;
  /** 정상·에러 종료 정리. 현재 run일 때만 로딩 off + 슬롯 해제. */
  end(run: AiRun): void;
  /** resumable 전용. 직전 run을 되살려 반환, 되살릴 수 없으면 null. */
  readopt(): AiRun | null;
  /** effect cleanup. store는 건드리지 않고 kind가 abort 여부를 결정한다. */
  detach(run: AiRun): void;
  /**
   * run 핸들 없이 정리해야 하는 자리(provider 교체 cleanup)용. oneshot은 abort +
   * onDispose + 슬롯 해제 + 로딩 off까지 하고, resumable은 no-op다(콜사이트 detach 담당).
   * 언마운트도 같은 처리를 헬퍼 내부에서 이걸로 한다.
   */
  disposeCurrent(): void;
}

export interface AiRunConfig {
  kind: AiRunKind;
  setLoading: (loading: boolean) => void;
  setAiCancel: (fn: (() => void) | null) => void;
  /** 슬롯이 아직 내 canceller인지 판정한다 — 없으면 남의 것을 덮어 지운다. */
  getAiCancel: () => (() => void) | null;
  onDispose?: (run: AiRun) => void;
}

export function useAiRun(config: AiRunConfig): AiRunController {
  const cfgRef = useRef(config);
  cfgRef.current = config;
  const currentRef = useRef<AiRunInternal | null>(null);
  const cancellerRef = useRef<(() => void) | null>(null);

  // 슬롯은 단일 슬롯이라 다른 surface가 그 사이 자기 canceller를 얹을 수 있다.
  // 내가 등록한 함수가 아직 그대로일 때만 비운다 — 아니면 남의 중단 버튼을 죽인다.
  const clearSlot = useCallback(() => {
    const own = cancellerRef.current;
    cancellerRef.current = null;
    if (!own) return;
    if (cfgRef.current.getAiCancel() !== own) return;
    cfgRef.current.setAiCancel(null);
  }, []);

  const controller = useMemo<AiRunController>(() => {
    // run당 최대 1회 — canceller가 current를 비우지 않아, 중단된 run이 settle하기 전
    // 재제출하면 begin()의 교체 경로가 같은 run을 또 dispose하려 든다.
    const dispose = (run: AiRunInternal) => {
      if (run.disposed) return;
      run.disposed = true;
      cfgRef.current.onDispose?.(run);
    };

    const begin = (): AiRun => {
      const prev = currentRef.current;
      if (prev) {
        // 교체된 run은 readopt 대상이 아니다 — 아무도 이어받지 않으므로 끊는다.
        prev.cancelled = true;
        prev.controller.abort();
        currentRef.current = null;
        dispose(prev);
      }

      const ac = new AbortController();
      const run: AiRunInternal = {
        cancelled: false,
        userCancelled: false,
        disposed: false,
        controller: ac,
        signal: ac.signal,
      };
      currentRef.current = run;

      const canceller = () => {
        if (run.userCancelled) return;
        run.cancelled = true;
        run.userCancelled = true;
        ac.abort();
        dispose(run);
        // 슬롯 해제는 end()가 한다 — 여기서 비우면 뒤늦은 end()가 자기 것을 못 알아본다.
        cfgRef.current.setLoading(false);
      };
      cancellerRef.current = canceller;
      cfgRef.current.setAiCancel(canceller);
      // 교체 경로에서도 false로 내리지 않는다 — StyleCssView가 하강 에지를
      // "AI 턴 종료"로 읽어 CodeMirror doc을 강행 재동기화한다(POSTMORTEM 2026-07-08).
      cfgRef.current.setLoading(true);
      return run;
    };

    const isActive = (run: AiRun) =>
      !(run as AiRunInternal).cancelled && currentRef.current === run;

    const end = (run: AiRun) => {
      if (currentRef.current !== run) return;
      currentRef.current = null;
      clearSlot();
      cfgRef.current.setLoading(false);
    };

    const readopt = (): AiRun | null => {
      const prev = currentRef.current;
      if (!prev || prev.userCancelled) return null;
      prev.cancelled = false;
      return prev;
    };

    const detach = (run: AiRun) => {
      const r = run as AiRunInternal;
      r.cancelled = true;
      if (cfgRef.current.kind === "oneshot") r.controller.abort();
    };

    // provider 교체 cleanup과 언마운트가 공유한다 — 둘 다 "이 run은 끝났고
    // 뒤늦은 end()가 정리하러 오지 않을 수도 있다"는 자리라 store까지 여기서 닫는다.
    const disposeCurrent = () => {
      const run = currentRef.current;
      if (!run) return;
      // resumable의 cleanup은 콜사이트 detach가 담당한다 — 여기서 끊으면
      // 게이트 왕복이 재개할 요청이 이미 죽어 영구 미충전이 된다.
      if (cfgRef.current.kind === "resumable") return;
      run.cancelled = true;
      run.controller.abort();
      currentRef.current = null;
      dispose(run);
      clearSlot();
      cfgRef.current.setLoading(false);
    };

    return { begin, isActive, end, readopt, detach, disposeCurrent };
  }, [clearSlot]);

  useEffect(() => () => controller.disposeCurrent(), [controller]);

  return controller;
}
