import { describe, expect, it } from "vitest";
import {
  INLINE_IMAGE_PREFIX,
  inlineImagePlaceholder,
  parseInlinePlaceholder,
} from "../adf-sentinels";

describe("inlineImagePlaceholder / parseInlinePlaceholder", () => {
  it("placeholder 생성 → 파싱 라운드트립으로 refId가 복원된다", () => {
    const refId = "ab12cd34";
    const placeholder = inlineImagePlaceholder(refId);
    expect(placeholder.startsWith(INLINE_IMAGE_PREFIX)).toBe(true);
    expect(parseInlinePlaceholder(placeholder)).toBe(refId);
  });

  it("prefix가 다르면 null", () => {
    expect(parseInlinePlaceholder("__OTHER:abc__")).toBe(null);
    expect(parseInlinePlaceholder("plain text")).toBe(null);
  });

  it("suffix(__)가 없으면 null", () => {
    expect(parseInlinePlaceholder(`${INLINE_IMAGE_PREFIX}abc`)).toBe(null);
  });

  it("빈 refId도 라운드트립된다", () => {
    expect(parseInlinePlaceholder(inlineImagePlaceholder(""))).toBe("");
  });
});
