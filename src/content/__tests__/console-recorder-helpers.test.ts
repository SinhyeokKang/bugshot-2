import { describe, it, expect } from "vitest";
import {
  formatErrorEvent,
  formatRejectionReason,
  shouldCaptureAssertion,
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
