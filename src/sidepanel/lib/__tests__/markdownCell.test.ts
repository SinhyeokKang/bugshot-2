import { describe, expect, it } from "vitest";
import { escapeTableCell } from "../markdownCell";

describe("escapeTableCell", () => {
  it("파이프를 이스케이프한다", () => {
    expect(escapeTableCell("a|b")).toBe("a\\|b");
    expect(escapeTableCell("|a|b|")).toBe("\\|a\\|b\\|");
  });

  it("개행(LF/CRLF)을 공백으로 치환한다", () => {
    expect(escapeTableCell("a\nb")).toBe("a b");
    expect(escapeTableCell("a\r\nb")).toBe("a b");
  });

  it("메타문자가 없으면 원문을 유지한다", () => {
    expect(escapeTableCell("plain text")).toBe("plain text");
    expect(escapeTableCell("")).toBe("");
  });

  it("파이프와 개행이 섞여도 둘 다 처리한다", () => {
    expect(escapeTableCell("a|b\nc")).toBe("a\\|b c");
  });
});
