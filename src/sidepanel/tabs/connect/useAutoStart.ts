import { useEffect, useRef } from "react";

/**
 * 재연동 intent를 받은 연결 셸이 스스로 한 번 열리게 한다. 셸이 둘(공용·Jira 전용)이라
 * 규칙을 두 번 적는 대신 여기 한 벌만 둔다.
 *
 * 래치가 셸 내부인 이유: 부모는 `onHandled`를 받고 intent를 지우지만 그 setState가 반영되기
 * 전에도 렌더는 돌아, ref 없이는 `ready`인 동안 매 렌더 재발화한다.
 *
 * `ready`가 거짓인 동안은 발화도, 소비 통보도 하지 않는다 — 수단 판정 전에 발화하면
 * 셸의 클릭 핸들러가 빈손으로 돌아가 아무것도 안 열리는데 intent만 소비된다.
 */
export function useAutoStart({
  autoStart,
  ready,
  onHandled,
  start,
}: {
  autoStart: boolean;
  ready: boolean;
  onHandled?: () => void;
  start: () => void;
}): void {
  const fired = useRef(false);
  // start·onHandled는 렌더마다 새 클로저다 — 의존성에 넣으면 매 렌더 재실행되고 그걸
  // 막는 건 결국 위 ref다. 반응해야 하는 축은 intent와 준비 상태 둘뿐이다.
  useEffect(() => {
    // 래치는 intent의 **상승 에지**에 걸려야 한다. false로 내려갈 때 풀지 않으면 셸이
    // 언마운트될 때까지 남고, 수단 다이얼로그를 취소하는 경로는 서브탭을 떠나지 않아
    // 언마운트가 안 일어난다 — 그 세션의 2차 만료가 통째로 무음이 된다(intent도 소비되지
    // 않아 서브탭이 "add"에 고착되는 2차 증상까지 붙는다).
    if (!autoStart) {
      fired.current = false;
      return;
    }
    if (fired.current || !ready) return;
    fired.current = true;
    onHandled?.();
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, ready]);
}
