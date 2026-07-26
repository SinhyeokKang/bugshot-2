import { describe, it, expect } from "vitest";
import { escapeHtml } from "../escapeHtml";

describe("escapeHtml", () => {
  it("4종을 모두 이스케이프한다 (&, <, >, \")", () => {
    expect(escapeHtml('&<>"')).toBe("&amp;&lt;&gt;&quot;");
  });

  // Asana html_notes 경로가 `"`를 빠뜨려 있었다 — 속성 문맥으로 흘러가면 곧 주입이다.
  it("따옴표를 빠뜨리지 않는다", () => {
    expect(escapeHtml('a"b')).toBe("a&quot;b");
  });

  it("& 를 먼저 처리해 이중 이스케이프가 안 난다", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("일반 문자열은 그대로", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
    expect(escapeHtml("")).toBe("");
  });
});
