import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLazyListOnOpen } from "../useLazyListOnOpen";

// 수동으로 resolve/reject하는 Promise. 응답을 "실제로 늦게" 도착시켜야
// in-flight 무효화가 재현된다 — 즉시 resolve하면 스코프 교체 전에 반영돼버린다.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useLazyListOnOpen — open 시 1회 로드", () => {
  it("닫혀 있으면 load를 부르지 않고, 열면 1회만 부른다", async () => {
    const d = deferred<string[]>();
    const load = vi.fn(() => d.promise);

    const { result, rerender } = renderHook(
      ({ open }) => useLazyListOnOpen(open, true, load),
      { initialProps: { open: false } },
    );

    expect(load).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    await act(async () => {
      d.resolve(["a", "b"]);
    });
    await waitFor(() => expect(result.current.items).toEqual(["a", "b"]));
    expect(result.current.loading).toBe(false);
  });

  it("같은 load로 닫았다 다시 열어도 재조회하지 않는다", async () => {
    const d = deferred<string[]>();
    const load = vi.fn(() => d.promise);

    const { result, rerender } = renderHook(
      ({ open }) => useLazyListOnOpen(open, true, load),
      { initialProps: { open: true } },
    );

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await act(async () => {
      d.resolve(["a"]);
    });
    await waitFor(() => expect(result.current.items).toEqual(["a"]));

    rerender({ open: false });
    rerender({ open: true });

    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.items).toEqual(["a"]);
  });

  it("enabled=false면 열려 있어도 부르지 않는다", () => {
    const load = vi.fn(() => deferred<string[]>().promise);

    renderHook(() => useLazyListOnOpen(true, false, load));

    expect(load).not.toHaveBeenCalled();
  });
});

describe("useLazyListOnOpen — in-flight 무효화 (🔴 race 근본 계약)", () => {
  it("load가 교체되면 이전 응답을 버리고 새 load로 재조회한다", async () => {
    const dA = deferred<string[]>();
    const dB = deferred<string[]>();
    const loadA = vi.fn(() => dA.promise);
    const loadB = vi.fn(() => dB.promise);

    const { result, rerender } = renderHook(
      ({ load }) => useLazyListOnOpen(true, true, load),
      { initialProps: { load: loadA } },
    );

    await waitFor(() => expect(loadA).toHaveBeenCalledTimes(1));

    // 스코프 교체 — A의 응답은 아직 오지 않았다.
    rerender({ load: loadB });
    await waitFor(() => expect(loadB).toHaveBeenCalledTimes(1));

    // 그제서야 A가 도착한다. 무효화됐으므로 items에 실리면 안 된다.
    await act(async () => {
      dA.resolve(["old"]);
    });
    expect(result.current.items).not.toContain("old");

    await act(async () => {
      dB.resolve(["new"]);
    });
    await waitFor(() => expect(result.current.items).toEqual(["new"]));
  });

  // 위 케이스는 열린 채 교체라 로드 effect가 스스로 reqId를 올려 통과한다.
  // 리셋 effect의 reqId 증가가 유일한 방어선인 건 **닫힌 채 교체**될 때다 —
  // 로드 effect가 조기 반환해 reqId를 못 올리기 때문. 실제 🔴 시나리오가 이 모양이다.
  it("닫힌 채로 load가 교체돼도 이전 응답을 버리고 재조회한다", async () => {
    const dA = deferred<string[]>();
    const dB = deferred<string[]>();
    const loadA = vi.fn(() => dA.promise);
    const loadB = vi.fn(() => dB.promise);

    const { result, rerender } = renderHook(
      ({ open, load }) => useLazyListOnOpen(open, true, load),
      { initialProps: { open: true, load: loadA } },
    );

    await waitFor(() => expect(loadA).toHaveBeenCalledTimes(1));

    // 응답이 오기 전에 닫고, 닫힌 상태에서 스코프를 교체한다.
    rerender({ open: false, load: loadA });
    rerender({ open: false, load: loadB });

    // 그제서야 A가 도착한다.
    await act(async () => {
      dA.resolve(["old"]);
    });
    expect(result.current.items).not.toContain("old");

    // 다시 열면 B로 조회해야 한다(이전 목록이 남아 재조회를 막으면 안 된다).
    rerender({ open: true, load: loadB });
    await waitFor(() => expect(loadB).toHaveBeenCalledTimes(1));

    await act(async () => {
      dB.resolve(["new"]);
    });
    await waitFor(() => expect(result.current.items).toEqual(["new"]));
  });

  // 위 두 케이스는 items가 빈 채로 교체돼서 리셋 effect의 setItems([])가 no-op이다.
  // 목록을 이미 받은 뒤 교체되는 이 흐름만이 그 줄을 지킨다 — 안 지우면 items.length > 0
  // 가드가 재조회를 영구히 막아, 사용자는 이전 스코프 목록에 갇힌다.
  it("목록을 받은 뒤 닫고 스코프를 바꾸면 이전 목록을 버리고 재조회한다", async () => {
    const dA = deferred<string[]>();
    const dB = deferred<string[]>();
    const loadA = vi.fn(() => dA.promise);
    const loadB = vi.fn(() => dB.promise);

    const { result, rerender } = renderHook(
      ({ open, load }) => useLazyListOnOpen(open, true, load),
      { initialProps: { open: true, load: loadA } },
    );

    await waitFor(() => expect(loadA).toHaveBeenCalledTimes(1));
    await act(async () => {
      dA.resolve(["a-item"]);
    });
    await waitFor(() => expect(result.current.items).toEqual(["a-item"]));

    // 목록을 손에 쥔 채 닫고, 닫힌 상태에서 스코프를 바꾼다.
    rerender({ open: false, load: loadA });
    rerender({ open: false, load: loadB });
    expect(result.current.items).toEqual([]);

    rerender({ open: true, load: loadB });
    await waitFor(() => expect(loadB).toHaveBeenCalledTimes(1));

    await act(async () => {
      dB.resolve(["b-item"]);
    });
    await waitFor(() => expect(result.current.items).toEqual(["b-item"]));
  });

  it("무효화된 이전 요청이 reject돼도 새 스코프에 그 에러를 세우지 않는다", async () => {
    const dA = deferred<string[]>();
    const dB = deferred<string[]>();
    const loadA = vi.fn(() => dA.promise);
    const loadB = vi.fn(() => dB.promise);

    const { result, rerender } = renderHook(
      ({ load }) => useLazyListOnOpen(true, true, load),
      { initialProps: { load: loadA } },
    );

    await waitFor(() => expect(loadA).toHaveBeenCalledTimes(1));
    rerender({ load: loadB });
    await waitFor(() => expect(loadB).toHaveBeenCalledTimes(1));

    await act(async () => {
      dA.reject(new Error("stale scope"));
    });
    expect(result.current.error).toBeNull();

    await act(async () => {
      dB.resolve(["new"]);
    });
    await waitFor(() => expect(result.current.items).toEqual(["new"]));
    expect(result.current.error).toBeNull();
  });

  it("무효화된 응답은 loading도 끄지 못한다", async () => {
    const dA = deferred<string[]>();
    const dB = deferred<string[]>();
    const loadA = vi.fn(() => dA.promise);
    const loadB = vi.fn(() => dB.promise);

    const { result, rerender } = renderHook(
      ({ load }) => useLazyListOnOpen(true, true, load),
      { initialProps: { load: loadA } },
    );

    await waitFor(() => expect(loadA).toHaveBeenCalledTimes(1));
    rerender({ load: loadB });
    await waitFor(() => expect(loadB).toHaveBeenCalledTimes(1));

    await act(async () => {
      dA.resolve(["old"]);
    });

    // B가 아직 미해결이므로 loading은 켜진 채여야 한다.
    expect(result.current.loading).toBe(true);
  });
});

describe("useLazyListOnOpen — 에러 처리", () => {
  it("reject되면 formatError 결과가 error에 담긴다", async () => {
    const d = deferred<string[]>();
    const load = vi.fn(() => d.promise);
    const formatError = (err: unknown) => `formatted:${String(err)}`;

    const { result } = renderHook(() =>
      useLazyListOnOpen(true, true, load, formatError),
    );

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await act(async () => {
      d.reject("boom");
    });

    await waitFor(() => expect(result.current.error).toBe("formatted:boom"));
    expect(result.current.loading).toBe(false);
  });

  // SingleLazyCombobox는 4번째 인자를 넘기지 않는다 — 이행한 콤보박스 7개가 전부 이 경로다.
  it("formatError를 안 넘기면 Error의 message를 쓴다", async () => {
    const d = deferred<string[]>();
    const load = vi.fn(() => d.promise);

    const { result } = renderHook(() => useLazyListOnOpen(true, true, load));

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await act(async () => {
      d.reject(new Error("멤버를 불러오지 못했습니다"));
    });

    await waitFor(() =>
      expect(result.current.error).toBe("멤버를 불러오지 못했습니다"),
    );
  });

  it("formatError를 안 넘겼을 때 비-Error가 던져지면 문자열화한다", async () => {
    const d = deferred<string[]>();
    const load = vi.fn(() => d.promise);

    const { result } = renderHook(() => useLazyListOnOpen(true, true, load));

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await act(async () => {
      d.reject("plain string");
    });

    await waitFor(() => expect(result.current.error).toBe("plain string"));
  });

  it("formatError가 렌더마다 새 함수여도 effect를 재실행시키지 않는다", async () => {
    const d = deferred<string[]>();
    const load = vi.fn(() => d.promise);

    const { rerender } = renderHook(
      // 렌더마다 새 함수 참조를 넘긴다(useT의 t가 그렇다).
      () => useLazyListOnOpen(true, true, load, (err) => String(err)),
    );

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    rerender();
    rerender();

    expect(load).toHaveBeenCalledTimes(1);
  });
});
