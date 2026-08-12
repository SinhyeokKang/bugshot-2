import { afterEach, describe, expect, it } from "vitest";
import { dateBcp47, getLocale, setLocale, t, withLocale } from "../index";

// 전역 스왑을 다루는 파일이라 케이스 간 누출이 다음 케이스의 단언을 오염시킨다.
afterEach(() => setLocale("ko"));

describe("withLocale", () => {
  it("fn 안에서 t()가 지정 로케일 값을 반환한다", () => {
    setLocale("ko");
    const inside = withLocale("en", () => t("md.section.env"));
    expect(inside).toBe("Environment");
  });

  it("종료 후 getLocale()이 진입 전 값으로 복원된다", () => {
    setLocale("ko");
    withLocale("en", () => t("md.section.env"));
    expect(getLocale()).toBe("ko");
  });

  it("fn의 반환값을 그대로 통과시킨다", () => {
    setLocale("ko");
    expect(withLocale("en", () => 42)).toBe(42);
    expect(withLocale("en", () => ({ a: 1 }))).toEqual({ a: 1 });
  });

  // try/finally가 없으면 여기서 로케일이 en인 채로 남는다 — 이 축의 가장 값싼 그물.
  it("fn이 throw해도 복원하고 예외를 호출부로 전파한다", () => {
    setLocale("ko");
    expect(() =>
      withLocale("en", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(getLocale()).toBe("ko");
  });

  it("중첩 호출이 각 층의 이전 값으로 복원된다", () => {
    setLocale("ko");
    const seen: string[] = [];
    withLocale("en", () => {
      seen.push(getLocale());
      withLocale("ko", () => {
        seen.push(getLocale());
      });
      seen.push(getLocale());
    });
    seen.push(getLocale());
    expect(seen).toEqual(["en", "ko", "en", "ko"]);
  });

  it("dateBcp47()도 스왑된 로케일을 반환한다 (Captured 시각 포맷)", () => {
    setLocale("ko");
    expect(withLocale("en", () => dateBcp47())).toBe("en-US");
    expect(dateBcp47()).toBe("ko-KR");
  });

  // 비동기 fn은 복원 시점과 실행 시점이 어긋나 무음 누출이 된다 — 즉시 실패시킨다.
  it("Promise를 반환하는 fn은 즉시 throw한다", () => {
    setLocale("ko");
    expect(() => withLocale("en", async () => "x")).toThrow();
    expect(() => withLocale("en", () => Promise.resolve(1))).toThrow();
  });

  it("Promise 거부 후에도 로케일이 복원된다", () => {
    setLocale("ko");
    try {
      withLocale("en", async () => "x");
    } catch {
      /* 위 케이스가 throw를 단언한다 */
    }
    expect(getLocale()).toBe("ko");
  });

  // 한계를 명시적으로 고정한다 — 다음 사람이 "비동기는 다 막힌다"로 과신하지 않도록.
  it("한계: void asyncFn()은 잡지 못한다 (반환된 Promise만 검사)", () => {
    setLocale("ko");
    expect(() =>
      withLocale("en", () => {
        void (async () => "x")();
      }),
    ).not.toThrow();
  });

  it("한계: setTimeout 콜백은 래핑 구간 밖이라 복원된 로케일을 본다", async () => {
    setLocale("ko");
    const seen = await new Promise<string>((resolve) => {
      withLocale("en", () => {
        setTimeout(() => resolve(getLocale()), 0);
      });
    });
    expect(seen).toBe("ko");
  });
});
