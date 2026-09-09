import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAutoStart } from "../useAutoStart";

const onHandled = vi.fn();
const start = vi.fn();

// 셸을 거치지 않고 훅을 직접 구동한다. 셸 테스트로는 `ready` 플랩 축을 못 만든다 —
// 앱 안에서 `autoStart`가 참인 구간의 `connecting`은 항상 거짓이라 그 조합이 도달 불가고,
// 그래서 셸 fixture로 재려던 케이스가 "구현을 지워도 green"인 채로 남았었다.
function Harness({ autoStart, ready }: { autoStart: boolean; ready: boolean }) {
  useAutoStart({ autoStart, ready, onHandled, start });
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAutoStart", () => {
  it("autoStart와 ready가 모두 참이면 1회 발화하고 소비를 알린다", () => {
    render(<Harness autoStart ready />);

    expect(start).toHaveBeenCalledTimes(1);
    expect(onHandled).toHaveBeenCalledTimes(1);
  });

  it("ready 전에는 발화도 소비도 하지 않는다", () => {
    const { rerender } = render(<Harness autoStart ready={false} />);
    expect(start).not.toHaveBeenCalled();
    expect(onHandled).not.toHaveBeenCalled();

    rerender(<Harness autoStart ready />);

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("autoStart가 아니면 ready여도 발화하지 않는다", () => {
    render(<Harness autoStart={false} ready />);

    expect(start).not.toHaveBeenCalled();
    expect(onHandled).not.toHaveBeenCalled();
  });

  // 래치가 실제로 막는 축. 부모가 intent를 지우기 전에 ready가 흔들리면 effect가 다시 도는데,
  // ref가 없으면 그때마다 재발화한다.
  it("autoStart가 참인 채 ready가 튀어도 재발화하지 않는다", () => {
    const { rerender } = render(<Harness autoStart ready />);
    rerender(<Harness autoStart ready={false} />);
    rerender(<Harness autoStart ready />);

    expect(start).toHaveBeenCalledTimes(1);
    expect(onHandled).toHaveBeenCalledTimes(1);
  });

  // 래치 해제는 intent의 하강 에지다. 셸 언마운트에만 맡기면, 수단 다이얼로그를 취소하는
  // 흐름이 서브탭을 안 떠나므로 그 세션의 2차 만료가 통째로 무음이 된다.
  it("autoStart가 내려갔다 다시 올라오면 재발화한다", () => {
    const { rerender } = render(<Harness autoStart ready />);
    rerender(<Harness autoStart={false} ready />);
    rerender(<Harness autoStart ready />);

    expect(start).toHaveBeenCalledTimes(2);
    expect(onHandled).toHaveBeenCalledTimes(2);
  });

  // 부모가 intent를 지우는 setState보다 렌더가 먼저 돌 수 있다 — 그 사이 재발화하면 안 된다.
  it("같은 intent가 유지되는 동안 재렌더해도 1회다", () => {
    const { rerender } = render(<Harness autoStart ready />);
    rerender(<Harness autoStart ready />);
    rerender(<Harness autoStart ready />);

    expect(start).toHaveBeenCalledTimes(1);
  });
});
