import { describe, expect, it, vi } from "vitest";

import * as appEvents from "@/lib/app-events";
import { createEmitter, onOAuthExpired } from "@/lib/app-events";

describe("createEmitter", () => {
  it("subscribe한 리스너가 fire 인자를 그대로 받는다", () => {
    const e = createEmitter<[platform: string | null]>();
    const fn = vi.fn();
    e.subscribe(fn);

    e.fire("jira");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("jira");
  });

  it("인자 없는 emitter는 무인자로 발화한다", () => {
    const e = createEmitter();
    const fn = vi.fn();
    e.subscribe(fn);

    e.fire();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]).toEqual([]);
  });

  it("리스너 여러 개가 전부 발화한다", () => {
    const e = createEmitter();
    const a = vi.fn();
    const b = vi.fn();
    e.subscribe(a);
    e.subscribe(b);

    e.fire();

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("subscribe 반환 함수를 호출하면 더 이상 발화하지 않는다", () => {
    const e = createEmitter();
    const fn = vi.fn();
    const off = e.subscribe(fn);

    e.fire();
    off();
    e.fire();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("해지는 그 리스너만 떼고 나머지는 남긴다", () => {
    const e = createEmitter();
    const a = vi.fn();
    const b = vi.fn();
    const offA = e.subscribe(a);
    e.subscribe(b);

    offA();
    e.fire();

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("같은 함수를 두 번 subscribe해도 한 번만 발화한다 (Set 의미)", () => {
    const e = createEmitter();
    const fn = vi.fn();
    e.subscribe(fn);
    e.subscribe(fn);

    e.fire();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  // 팩토리가 리스너 집합을 클로저 밖(모듈 스코프)에 두면 모든 emitter가 한 통이 된다.
  // 그러면 아래 7종이 서로의 리스너를 발화시키므로 이 케이스가 유일한 그물이다.
  it("팩토리가 만든 emitter들은 리스너 집합을 공유하지 않는다", () => {
    const a = createEmitter();
    const b = createEmitter();
    const fnA = vi.fn();
    const fnB = vi.fn();
    a.subscribe(fnA);
    b.subscribe(fnB);

    a.fire();

    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).not.toHaveBeenCalled();
  });
});

type LooseEvent = {
  subscribe(fn: (...args: unknown[]) => void): () => void;
  fire(...args: unknown[]): void;
};

describe("app-events 인스턴스", () => {
  // 로스터를 모듈에서 파생한다. 손으로 쓴 리터럴을 세면 삭제 방향만 잡히고(named import
  // 실패) 추가 방향은 그물이 0이라, 8번째 emitter가 카운트에도 아래 독립성 루프에도 안 걸린다.
  const emitters = Object.entries(appEvents).filter(
    ([name]) => name !== "createEmitter",
  ) as Array<[string, LooseEvent]>;

  it("emitter 7종이 전부 subscribe·fire를 가진 객체다", () => {
    expect(emitters.map(([n]) => n)).toHaveLength(7);
    for (const [name, e] of emitters) {
      expect(typeof e?.subscribe, name).toBe("function");
      expect(typeof e?.fire, name).toBe("function");
    }
  });

  it("각 emitter는 독립이다 — 하나를 fire해도 나머지는 조용하다", () => {
    for (const [firedName, fired] of emitters) {
      const spies = new Map<string, ReturnType<typeof vi.fn>>();
      const offs = emitters.map(([name, e]) => {
        const fn = vi.fn();
        spies.set(name, fn);
        return e.subscribe(fn);
      });

      fired.fire(null);

      for (const [name] of emitters) {
        expect(spies.get(name), `${firedName} → ${name}`).toHaveBeenCalledTimes(
          name === firedName ? 1 : 0,
        );
      }
      offs.forEach((off) => off());
    }
  });

  it("onOAuthExpired는 platform 인자를 전달한다", () => {
    const fn = vi.fn();
    const off = onOAuthExpired.subscribe(fn);

    onOAuthExpired.fire("github");
    off();

    expect(fn).toHaveBeenCalledWith("github");
  });
});
