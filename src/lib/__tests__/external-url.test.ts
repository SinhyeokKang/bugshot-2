import { describe, expect, it } from "vitest";
import { isSafeExternalUrl, safeExternalHref } from "../external-url";

describe("isSafeExternalUrl", () => {
  it("http URL → true", () => {
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
  });

  it("https URL → true", () => {
    expect(isSafeExternalUrl("https://example.com/browse/ABC-1?x=1#y")).toBe(true);
  });

  it("스킴 대문자도 → true", () => {
    expect(isSafeExternalUrl("HTTPS://example.com")).toBe(true);
  });

  it("javascript: → false", () => {
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
  });

  it("대소문자 혼합 javascript: → false", () => {
    expect(isSafeExternalUrl("JaVaScRiPt:alert(1)")).toBe(false);
  });

  it("data: → false", () => {
    expect(isSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("vbscript: → false", () => {
    expect(isSafeExternalUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("선행 제어문자 + javascript: → false", () => {
    expect(isSafeExternalUrl("\x01javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("\x00javascript:alert(1)")).toBe(false);
  });

  it("선행 공백 + javascript: → false", () => {
    expect(isSafeExternalUrl("  javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("\n\tjavascript:alert(1)")).toBe(false);
  });

  it("프로토콜 상대 URL → false", () => {
    expect(isSafeExternalUrl("//evil.example.com")).toBe(false);
  });

  it("상대 경로 → false", () => {
    expect(isSafeExternalUrl("/browse/ABC-1")).toBe(false);
  });

  it("file: → false", () => {
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
  });

  it("chrome-extension: → false", () => {
    expect(isSafeExternalUrl("chrome-extension://abc/popup.html")).toBe(false);
  });

  it("http/https 접두사만 흉내낸 스킴 → false", () => {
    expect(isSafeExternalUrl("httpsx://example.com")).toBe(false);
    expect(isSafeExternalUrl("javascript:https://example.com")).toBe(false);
  });

  it("undefined·null·빈 문자열 → false", () => {
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
  });
});

describe("safeExternalHref", () => {
  it("안전한 URL은 그대로 반환", () => {
    expect(safeExternalHref("https://example.com/x")).toBe("https://example.com/x");
  });

  it("위험한 URL은 undefined", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHref("//evil.example.com")).toBeUndefined();
  });

  it("undefined·null은 undefined", () => {
    expect(safeExternalHref(undefined)).toBeUndefined();
    expect(safeExternalHref(null)).toBeUndefined();
  });
});
