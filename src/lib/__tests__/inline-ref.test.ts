import { describe, expect, it } from "vitest";

import {
  INLINE_REF_RE,
  inlinePlaceholderId,
  inlineRefMarkdown,
  inlineRefUrl,
  inlineUploadFilename,
} from "../inline-ref";

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

// 헬퍼가 아니라 리터럴로 단언한다 — 헬퍼를 부르면 반환값이 바뀌어도 통과하는 동어반복이 된다.
describe("inlineUploadFilename", () => {
  it("확장자를 안 주면 캡처 기본 포맷인 webp", () => {
    expect(inlineUploadFilename("abc")).toBe("inline-abc.webp");
  });

  it("확장자를 주면 그대로 쓴다 (Asana는 원본 포맷을 따라간다)", () => {
    expect(inlineUploadFilename("abc", "jpg")).toBe("inline-abc.jpg");
    expect(inlineUploadFilename("abc", "png")).toBe("inline-abc.png");
  });

  it("placeholder id와 접두사를 공유한다", () => {
    expect(inlineUploadFilename("abc")).toBe(`${inlinePlaceholderId("abc")}.webp`);
  });
});

describe("inlinePlaceholderId", () => {
  it("확장자 없이 refId만 감싼다", () => {
    expect(inlinePlaceholderId("abc")).toBe("inline-abc");
  });
});

describe("INLINE_REF_RE", () => {
  function allRefIds(md: string): string[] {
    return [...md.matchAll(new RegExp(INLINE_REF_RE.source, INLINE_REF_RE.flags))].map(
      (m) => m[2],
    );
  }

  it("한 문자열의 참조를 전부 뽑는다 (전역 플래그)", () => {
    const md = `${inlineRefMarkdown("a")} 사이 텍스트 ${inlineRefMarkdown("b", "alt")}`;
    expect(allRefIds(md)).toEqual(["a", "b"]);
  });

  it("refId의 하이픈·숫자를 보존한다", () => {
    expect(allRefIds(inlineRefMarkdown("img-2f3a-01"))).toEqual(["img-2f3a-01"]);
  });

  it("alt의 공백·유니코드를 캡처 그룹 1로 돌려준다", () => {
    const m = new RegExp(INLINE_REF_RE.source, INLINE_REF_RE.flags).exec(
      inlineRefMarkdown("a", "스크린샷 1"),
    );
    expect(m?.[1]).toBe("스크린샷 1");
  });

  it("inline: 스킴이 아닌 일반 이미지는 매치하지 않는다", () => {
    expect(allRefIds("![](https://example.com/a.png)")).toEqual([]);
    expect(allRefIds("![](inlined:a)")).toEqual([]);
  });
});
