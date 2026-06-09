import { describe, it, expect } from "vitest";
import {
  shouldMaskField,
  maskValue,
  truncateName,
  entryNavOnBind,
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

  it("aria-label의 민감 키워드로 마스킹 (contentEditable 사각지대 보강)", () => {
    expect(shouldMaskField({ ariaLabel: "Card number" })).toBe(true);
    expect(shouldMaskField({ ariaLabel: "CVV" })).toBe(true);
    expect(shouldMaskField({ ariaLabel: "Full name" })).toBe(false);
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

describe("truncateName", () => {
  it("이름 trim 후 그대로 반환", () => {
    expect(truncateName("  Submit  ")).toBe("Submit");
  });

  it("빈 이름·null·undefined는 undefined", () => {
    expect(truncateName("")).toBeUndefined();
    expect(truncateName("   ")).toBeUndefined();
    expect(truncateName(null)).toBeUndefined();
    expect(truncateName(undefined)).toBeUndefined();
  });

  it("긴 이름은 cap(80) + 말줄임", () => {
    const out = truncateName("A".repeat(200))!;
    expect(out.length).toBeLessThan(200);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("entryNavOnBind", () => {
  it("최초 bind면 referrer→현재 URL 진입 네비게이션을 반환", () => {
    expect(
      entryNavOnBind(false, "https://app.com/login", "https://app.com/login", "https://idp.com/authorize"),
    ).toEqual({ fromUrl: "https://app.com/login", toUrl: "https://idp.com/authorize" });
  });

  it("referrer가 비면 lastUrl로 fallback (cross-origin referrer 정책으로 referrer 소실 대비)", () => {
    expect(
      entryNavOnBind(false, "", "https://idp.com/authorize", "https://app.com/callback"),
    ).toEqual({ fromUrl: "https://idp.com/authorize", toUrl: "https://app.com/callback" });
  });

  it("이미 emit했으면 null — 같은 페이지 재bind(setSentinel 재호출) 시 중복 방지", () => {
    expect(
      entryNavOnBind(true, "https://app.com", "https://app.com", "https://idp.com"),
    ).toBeNull();
  });
});
