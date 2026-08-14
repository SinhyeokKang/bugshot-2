import { describe, expect, it } from "vitest";

import { INLINE_REF_RE, inlineRefMarkdown, inlineRefUrl } from "../inline-ref";

describe("inlineRefUrl", () => {
  it("refId를 inline: 스킴으로 감싼다", () => {
    expect(inlineRefUrl("abc")).toBe("inline:abc");
  });
});

describe("inlineRefMarkdown", () => {
  // 현재 생성물이 ![](...)이라 기본값이 다르면 본문 마크다운이 조용히 바뀐다.
  it("alt 기본값은 빈 문자열", () => {
    expect(inlineRefMarkdown("abc")).toBe("![](inline:abc)");
  });

  it("alt를 주면 그대로 싣는다", () => {
    expect(inlineRefMarkdown("abc", "x")).toBe("![x](inline:abc)");
  });
});

// 생성기와 파싱(INLINE_REF_RE)이 갈리면 삭제 판정이 살아있는 이미지를 고아로 오판한다.
describe("생성 ↔ 파싱 왕복", () => {
  function parseFirst(md: string): { alt: string; refId: string } | null {
    const re = new RegExp(INLINE_REF_RE.source, INLINE_REF_RE.flags);
    const m = re.exec(md);
    return m ? { alt: m[1], refId: m[2] } : null;
  }

  it("생성물이 INLINE_REF_RE로 파싱돼 refId를 되돌려준다", () => {
    expect(parseFirst(inlineRefMarkdown("img-1"))).toEqual({ alt: "", refId: "img-1" });
  });

  it("alt가 있어도 refId가 보존된다", () => {
    expect(parseFirst(inlineRefMarkdown("img-1", "screenshot"))).toEqual({
      alt: "screenshot",
      refId: "img-1",
    });
  });

  it("본문 중간에 섞여 있어도 파싱된다", () => {
    const body = `앞 문장\n\n${inlineRefMarkdown("img-2")}\n\n뒤 문장`;
    expect(parseFirst(body)?.refId).toBe("img-2");
  });
});
