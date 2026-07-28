import { vi } from "vitest";
import type { AISession } from "@/sidepanel/lib/ai-provider";

/** 호출을 붙잡아 두고 테스트가 원할 때 settle시킨다 — 취소 시점을 제어해야 signal을 의미 있게 단언할 수 있다. */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface FakeSession {
  session: AISession;
  /** prompt에 실제로 넘어온 인자 — signal을 직접 단언하기 위해 보관한다. */
  calls: { input: string; signal?: AbortSignal }[];
  pending: ReturnType<typeof deferred<string>>[];
  destroy: ReturnType<typeof vi.fn>;
}

/**
 * `AISession`을 타입 그대로 만족시키는 fake. 캐스트를 쓰지 않으므로 `prompt`의
 * 옵션에서 `signal`이 빠지거나 이름이 바뀌면 여기서 typecheck가 깨진다 —
 * signal을 무시하는 mock이 취소 회귀를 green으로 통과시키던 함정을 막는다(POSTMORTEM 2026-07-28).
 */
export function makeSession(): FakeSession {
  const calls: FakeSession["calls"] = [];
  const pending: ReturnType<typeof deferred<string>>[] = [];
  const destroy = vi.fn();
  const session: AISession = {
    prompt: (input, options) => {
      calls.push({ input, signal: options?.signal });
      const d = deferred<string>();
      pending.push(d);
      return d.promise;
    },
    destroy,
  };
  return { session, calls, pending, destroy };
}
