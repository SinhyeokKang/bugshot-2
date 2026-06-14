import { describe, it, expect, vi } from "vitest";
import {
  ARG_CAP,
  formatErrorEvent,
  formatRejectionReason,
  installConsoleWrap,
  makeConsoleWrapper,
  restoreConsoleWrap,
  safeStringify,
  serializeArgs,
  shouldCaptureAssertion,
  shouldRestoreWrapper,
} from "../console-recorder-helpers";

describe("formatErrorEvent", () => {
  it("message + filename:line:col 포맷", () => {
    const out = formatErrorEvent({
      message: "x is not a function",
      filename: "https://example.com/app.js",
      lineno: 12,
      colno: 5,
    });
    expect(out.args).toBe(
      "Uncaught x is not a function at https://example.com/app.js:12:5",
    );
  });

  it("Error 객체가 있으면 stack 추출", () => {
    const err = new Error("boom");
    const out = formatErrorEvent({ message: "boom", error: err });
    expect(out.stack).toBe(err.stack);
  });

  it("filename 없으면 location 생략", () => {
    expect(formatErrorEvent({ message: "boom" }).args).toBe("Uncaught boom");
  });

  it("message 비어있으면 'Error'로 폴백", () => {
    expect(formatErrorEvent({ message: "" }).args).toBe("Uncaught Error");
  });

  it("error가 Error 아니면 stack 없음", () => {
    expect(formatErrorEvent({ message: "x", error: "string-thrown" }).stack).toBeUndefined();
  });
});

describe("formatRejectionReason", () => {
  it("Error reason → name+message + stack", () => {
    const err = new TypeError("nope");
    const out = formatRejectionReason(err);
    expect(out.args).toBe("Unhandled promise rejection: TypeError: nope");
    expect(out.stack).toBe(err.stack);
  });

  it("string reason", () => {
    expect(formatRejectionReason("oops").args).toBe(
      "Unhandled promise rejection: oops",
    );
  });

  it("plain object reason → JSON", () => {
    expect(formatRejectionReason({ code: 42 }).args).toBe(
      'Unhandled promise rejection: {"code":42}',
    );
  });

  it("circular reference도 throw하지 않는다", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => formatRejectionReason(obj)).not.toThrow();
  });

  it("undefined reason도 처리", () => {
    expect(formatRejectionReason(undefined).args).toBe(
      "Unhandled promise rejection: undefined",
    );
  });
});

describe("safeStringify", () => {
  it("원시값 — string/number/boolean/null/undefined/bigint", () => {
    expect(safeStringify("hi", 0)).toBe("hi");
    expect(safeStringify(42, 0)).toBe("42");
    expect(safeStringify(true, 0)).toBe("true");
    expect(safeStringify(null, 0)).toBe("null");
    expect(safeStringify(undefined, 0)).toBe("undefined");
    expect(safeStringify(10n, 0)).toBe("10n");
  });

  it("function은 이름 표기", () => {
    expect(safeStringify(function foo() {}, 0)).toBe("[Function: foo]");
    expect(safeStringify(() => {}, 0)).toMatch(/^\[Function:/);
  });

  it("Error는 stack/메시지", () => {
    expect(safeStringify(new Error("oops"), 0)).toContain("oops");
  });

  it("배열은 요소 직렬화 + 20개 초과 절단", () => {
    expect(safeStringify([1, 2, 3], 0)).toBe("[1, 2, 3]");
    expect(safeStringify([], 0)).toBe("[]");
    const big = Array.from({ length: 25 }, (_, i) => i);
    expect(safeStringify(big, 0)).toContain("...+5");
  });

  it("plain object는 JSON", () => {
    expect(safeStringify({ a: 1 }, 0)).toContain('"a": 1');
  });

  it("순환 참조는 [Circular]", () => {
    const c: Record<string, unknown> = {};
    c.self = c;
    expect(safeStringify(c, 0)).toContain("[Circular]");
  });

  it("depth 초과는 [...]로 절단", () => {
    expect(safeStringify("x", 6)).toBe("[...]");
  });

  // 회귀 가드: 페이지가 console.log에 넘긴 악성 값이 throw해도 절대 밖으로 전파하지 않는다.
  // (전파되면 wrap된 console.* = 페이지 코드가 깨진다)
  it("throwing getter가 있어도 throw하지 않는다", () => {
    const evil = {};
    Object.defineProperty(evil, "bad", {
      enumerable: true,
      get() { throw new Error("getter boom"); },
    });
    expect(() => safeStringify(evil, 0)).not.toThrow();
  });

  it("toJSON·toString 모두 throw해도 [unserializable]", () => {
    const evil = {
      toJSON() { throw new Error("toJSON boom"); },
      toString() { throw new Error("toString boom"); },
    };
    expect(safeStringify(evil, 0)).toBe("[unserializable]");
  });

  it("Symbol.toPrimitive가 throw하는 값도 안전", () => {
    const evil = { [Symbol.toPrimitive]() { throw new Error("toPrimitive boom"); } };
    expect(() => safeStringify(evil, 0)).not.toThrow();
  });

  it("get/ownKeys trap이 throw하는 Proxy도 안전", () => {
    const evil = new Proxy({}, {
      get() { throw new Error("trap boom"); },
      ownKeys() { throw new Error("ownKeys boom"); },
    });
    expect(() => safeStringify(evil, 0)).not.toThrow();
  });
});

describe("serializeArgs", () => {
  it("공백으로 join", () => {
    expect(serializeArgs(["a", 1, true])).toBe("a 1 true");
  });

  it("ARG_CAP 초과 시 절단 + ...", () => {
    const big = "x".repeat(ARG_CAP + 100);
    const out = serializeArgs([big]);
    expect(out.endsWith("...")).toBe(true);
    expect(out.length).toBe(ARG_CAP + 3);
  });

  it("throw하는 인자가 섞여도 throw하지 않고 나머지를 직렬화", () => {
    const evil = {
      toJSON() { throw new Error("boom"); },
      toString() { throw new Error("boom"); },
    };
    expect(() => serializeArgs(["ok", evil, "tail"])).not.toThrow();
    const out = serializeArgs(["ok", evil, "tail"]);
    expect(out).toContain("ok");
    expect(out).toContain("tail");
  });
});

describe("shouldCaptureAssertion", () => {
  it("falsy → true (캡처)", () => {
    expect(shouldCaptureAssertion(false)).toBe(true);
    expect(shouldCaptureAssertion(0)).toBe(true);
    expect(shouldCaptureAssertion("")).toBe(true);
    expect(shouldCaptureAssertion(null)).toBe(true);
    expect(shouldCaptureAssertion(undefined)).toBe(true);
  });

  it("truthy → false (스킵)", () => {
    expect(shouldCaptureAssertion(true)).toBe(false);
    expect(shouldCaptureAssertion(1)).toBe(false);
    expect(shouldCaptureAssertion("x")).toBe(false);
    expect(shouldCaptureAssertion({})).toBe(false);
  });
});

describe("makeConsoleWrapper", () => {
  it("native를 받은 인자 그대로 동기 호출", () => {
    const native = vi.fn();
    const record = vi.fn();
    const wrapper = makeConsoleWrapper(native, "error", record);
    const err = new Error("boom");
    wrapper("msg", 42, err);
    expect(native).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledWith("msg", 42, err);
  });

  it("record가 (level, args)로 1회 호출", () => {
    const native = vi.fn();
    const record = vi.fn();
    const wrapper = makeConsoleWrapper(native, "warn", record);
    wrapper("a", "b");
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("warn", ["a", "b"]);
  });

  it("native가 record보다 먼저 호출", () => {
    const order: string[] = [];
    const native = vi.fn(() => order.push("native"));
    const record = vi.fn(() => order.push("record"));
    const wrapper = makeConsoleWrapper(native, "error", record);
    wrapper("x");
    expect(order).toEqual(["native", "record"]);
  });

  // 무간섭 원칙 ①②: record(혹은 captureStack)가 throw해도 페이지의 console.* 호출자로
  // 전파되면 안 된다. native는 먼저 호출됐어야 한다.
  it("record가 throw해도 native는 호출됐고 wrapper 호출자에게 전파 안 됨", () => {
    const native = vi.fn();
    const record = vi.fn(() => {
      throw new Error("record boom");
    });
    const wrapper = makeConsoleWrapper(native, "error", record);
    expect(() => wrapper("x")).not.toThrow();
    expect(native).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledWith("x");
  });
});

describe("shouldRestoreWrapper", () => {
  it("동일 참조면 true", () => {
    const fn = () => {};
    expect(shouldRestoreWrapper(fn, fn)).toBe(true);
  });

  it("다른 함수면 false (페이지가 위에 재wrap)", () => {
    expect(shouldRestoreWrapper(() => {}, () => {})).toBe(false);
  });
});

describe("installConsoleWrap", () => {
  it("미설치 상태면 wrappers를 target에 할당하고 가드를 올림", () => {
    const ourError = () => {};
    const ourWarn = () => {};
    const target = { error: () => {}, warn: () => {} };
    const wrappers = { error: ourError, warn: ourWarn };
    const state = { installed: false };
    installConsoleWrap(target, wrappers, state);
    expect(target.error).toBe(ourError);
    expect(target.warn).toBe(ourWarn);
    expect(state.installed).toBe(true);
  });

  it("이미 installed면 no-op (멱등 — 재할당 안 함)", () => {
    const ourError = () => {};
    const ourWarn = () => {};
    const pageError = () => {};
    const pageWarn = () => {};
    // 페이지가 우리 wrap 위에 덧씌운 상태를 흉내: installed=true인데 target은 페이지 함수.
    const target = { error: pageError, warn: pageWarn };
    const wrappers = { error: ourError, warn: ourWarn };
    const state = { installed: true };
    installConsoleWrap(target, wrappers, state);
    expect(target.error).toBe(pageError);
    expect(target.warn).toBe(pageWarn);
    expect(state.installed).toBe(true);
  });
});

describe("restoreConsoleWrap", () => {
  it("현재가 우리 wrapper면 natives로 복원하고 가드를 내림", () => {
    const ourError = () => {};
    const ourWarn = () => {};
    const nativeError = () => {};
    const nativeWarn = () => {};
    const target = { error: ourError, warn: ourWarn };
    const wrappers = { error: ourError, warn: ourWarn };
    const natives = { error: nativeError, warn: nativeWarn };
    const state = { installed: true };
    restoreConsoleWrap(target, wrappers, natives, state);
    expect(target.error).toBe(nativeError);
    expect(target.warn).toBe(nativeWarn);
    expect(state.installed).toBe(false);
  });

  it("페이지가 덧씌웠으면(현재≠우리 wrapper) 복원 스킵·보존, 가드만 내림", () => {
    const ourError = () => {};
    const ourWarn = () => {};
    const nativeError = () => {};
    const nativeWarn = () => {};
    const pageError = () => {};
    const pageWarn = () => {};
    const target = { error: pageError, warn: pageWarn };
    const wrappers = { error: ourError, warn: ourWarn };
    const natives = { error: nativeError, warn: nativeWarn };
    const state = { installed: true };
    restoreConsoleWrap(target, wrappers, natives, state);
    expect(target.error).toBe(pageError);
    expect(target.warn).toBe(pageWarn);
    expect(state.installed).toBe(false);
  });

  it("혼합 — error만 우리 wrapper, warn은 페이지 덧씌움", () => {
    const ourError = () => {};
    const ourWarn = () => {};
    const nativeError = () => {};
    const nativeWarn = () => {};
    const pageWarn = () => {};
    const target = { error: ourError, warn: pageWarn };
    const wrappers = { error: ourError, warn: ourWarn };
    const natives = { error: nativeError, warn: nativeWarn };
    const state = { installed: true };
    restoreConsoleWrap(target, wrappers, natives, state);
    expect(target.error).toBe(nativeError);
    expect(target.warn).toBe(pageWarn);
    expect(state.installed).toBe(false);
  });
});
