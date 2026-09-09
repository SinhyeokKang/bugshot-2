import { useEffect, useRef } from "react";

/**
 * 재연동 intent를 받은 연결 셸이 스스로 한 번 열리게 한다. 셸이 둘(공용·Jira 전용)이라
 * 규칙을 두 번 적는 대신 여기 한 벌만 둔다.
 *
 * 래치가 셸 내부인 이유: 의존성 배열이 `ready`를 포함하므로, `autoStart`가 참인 채 `ready`가
 * true→false→true로 튀면 effect가 다시 돌아 재발화한다. 부모가 `onHandled`로 intent를 지우기
 * 전이면 그 재발화를 막을 게 없다. (앱 안에서 그 플랩은 현재 도달 불가다 — `autoStart`가 참인
 * 구간에서 `connecting`은 항상 거짓이고 `methods`는 0→1+로 한 번만 간다. 그래도 계약으로 두는
 * 건 불변식이 미래 변경에 깨질 때 실패 모드가 무음 이중 발화이기 때문이고, 도달 불가한 축을
 * 재려고 훅 단위 테스트를 따로 둔다.)
 *
 * `ready`가 거짓인 동안은 발화도, 소비 통보도 하지 않는다 — 수단 판정 전에 발화하면
 * 셸의 클릭 핸들러가 빈손으로 돌아가 아무것도 안 열리는데 intent만 소비된다.
 * 예외: 판정이 **거짓으로 확정**되는 셸(Slack — OAuth 전용이라 미구성이면 영원히 못 연다)은
 * 그 상태도 ready로 올린다. 영영 소비하지 않으면 intent가 고착돼 서브탭이 "add"에 붙는다.
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
