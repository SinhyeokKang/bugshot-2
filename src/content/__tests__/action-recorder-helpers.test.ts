import { describe, it, expect } from "vitest";
import {
  shouldMaskField,
  maskValue,
  describeActionTarget,
  inputDedupKey,
} from "../action-recorder-helpers";

describe("shouldMaskField", () => {
  it("type=password면 마스킹", () => {
    expect(shouldMaskField({ type: "password" })).toBe(true);
  });

  it("일반 텍스트 username은 마스킹 안 함", () => {
    expect(shouldMaskField({ type: "text", name: "username" })).toBe(false);
  });

  it("민감 name/id는 마스킹 (cardNumber·cvv·user_ssn)", () => {
    expect(shouldMaskField({ name: "cardNumber" })).toBe(true);
    expect(shouldMaskField({ id: "cvv" })).toBe(true);
    expect(shouldMaskField({ name: "user_ssn" })).toBe(true);
  });

  it("autocomplete 힌트로 마스킹 (current-password·cc-number)", () => {
    expect(shouldMaskField({ autocomplete: "current-password" })).toBe(true);
    expect(shouldMaskField({ autocomplete: "cc-number" })).toBe(true);
  });

  it("힌트 전무하면 마스킹 안 함", () => {
    expect(shouldMaskField({})).toBe(false);
  });
});

describe("maskValue", () => {
  it("임의 값을 *** 로 치환", () => {
    expect(maskValue("hunter2")).toBe("***");
    expect(maskValue("")).toBe("***");
  });
});

describe("describeActionTarget", () => {
  it("accessibleName 있으면 자연어에 이름 포함", () => {
    const out = describeActionTarget({
      tag: "button",
      role: "button",
      accessibleName: "Submit",
      selector: "button#submit",
    });
    expect(out).toContain("Submit");
  });

  it("accessibleName 없으면 selector 폴백", () => {
    const out = describeActionTarget({
      tag: "div",
      role: null,
      accessibleName: null,
      selector: "div.card:nth-child(2)",
    });
    expect(out).toBe("div.card:nth-child(2)");
  });

  it("긴 accessibleName은 truncate", () => {
    const long = "A".repeat(200);
    const out = describeActionTarget({
      tag: "button",
      role: "button",
      accessibleName: long,
      selector: "button",
    });
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("…");
  });
});

describe("inputDedupKey", () => {
  it("같은 selector면 같은 키 (결정적)", () => {
    expect(inputDedupKey("input#email")).toBe(inputDedupKey("input#email"));
  });

  it("다른 selector면 다른 키", () => {
    expect(inputDedupKey("input#email")).not.toBe(inputDedupKey("input#name"));
  });
});
