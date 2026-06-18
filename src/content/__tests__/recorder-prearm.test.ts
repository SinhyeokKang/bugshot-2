import { describe, it, expect, afterEach, vi } from "vitest";
import { isPreArmFlag, readPreArmFlag, setPreArmFlag, PREARM_FLAG_KEY } from "../recorder-prearm";

// pre-arm 게이트: document_start에서 sessionStorage 플래그를 동기로 읽어 pre-arm 여부 결정.
// 순수 판정부 isPreArmFlag만 단위 검증 (read/set 래퍼는 sessionStorage 부수효과라 제외).
describe("isPreArmFlag", () => {
  it("플래그 값이 정확히 \"1\"이면 pre-arm 활성", () => {
    expect(isPreArmFlag("1")).toBe(true);
  });

  it("플래그가 없으면(null) 비활성", () => {
    expect(isPreArmFlag(null)).toBe(false);
  });

  it("빈 문자열은 비활성", () => {
    expect(isPreArmFlag("")).toBe(false);
  });

  it("\"0\"은 비활성", () => {
    expect(isPreArmFlag("0")).toBe(false);
  });

  it("\"1\" 외의 truthy 문자열(\"true\")은 비활성 — 정확히 \"1\"만 인정", () => {
    expect(isPreArmFlag("true")).toBe(false);
  });
});

// read/set 래퍼: sandboxed iframe 등 sessionStorage 접근 불가 환경의 throw가
// pre-arm을 안전하게 비활성 처리하는지(catch 분기) 검증.
describe("readPreArmFlag / setPreArmFlag", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("setPreArmFlag로 쓴 값을 readPreArmFlag가 활성으로 읽는다", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    expect(readPreArmFlag()).toBe(false);
    setPreArmFlag();
    expect(store.get(PREARM_FLAG_KEY)).toBe("1");
    expect(readPreArmFlag()).toBe(true);
  });

  it("sessionStorage 접근이 throw하면(sandboxed) readPreArmFlag는 false", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("sandboxed");
      },
    });
    expect(readPreArmFlag()).toBe(false);
  });

  it("sessionStorage가 throw해도 setPreArmFlag는 예외를 삼킨다", () => {
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("sandboxed");
      },
    });
    expect(() => setPreArmFlag()).not.toThrow();
  });
});
