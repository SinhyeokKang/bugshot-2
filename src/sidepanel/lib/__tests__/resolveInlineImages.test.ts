import { describe, it, expect, vi } from "vitest";

vi.mock("@/store/blob-db", () => ({
  getInlineImage: vi.fn(async (refId: string) =>
    refId === "missing" ? null : ({ __ref: refId } as unknown as Blob),
  ),
  blobToDataUrl: vi.fn(
    async (blob: unknown) => `data:image/png;${(blob as { __ref: string }).__ref}`,
  ),
}));

import {
  extractInlineRefs,
  replaceInlineRefs,
  stripInlineImageRefs,
  resolveSectionImages,
  type SectionFilter,
} from "../resolveInlineImages";

describe("extractInlineRefs", () => {
  it("inline 참조 없는 마크다운 → 빈 배열", () => {
    expect(extractInlineRefs("hello world")).toEqual([]);
    expect(extractInlineRefs("![](https://example.com/img.png)")).toEqual([]);
  });

  it("inline 참조 1개 → refId 추출", () => {
    const result = extractInlineRefs("![](inline:abc12345)");
    expect(result).toEqual(["abc12345"]);
  });

  it("alt text 포함 참조 → refId 추출", () => {
    const result = extractInlineRefs("![my image](inline:def67890)");
    expect(result).toEqual(["def67890"]);
  });

  it("여러 참조 → 전부 추출", () => {
    const md =
      "text ![](inline:aaa11111) middle ![alt](inline:bbb22222) end";
    const result = extractInlineRefs(md);
    expect(result).toEqual(["aaa11111", "bbb22222"]);
  });

  it("중복 참조 → 중복 제거", () => {
    const md = "![](inline:same1234) and ![](inline:same1234)";
    const result = extractInlineRefs(md);
    expect(result).toEqual(["same1234"]);
  });
});

describe("replaceInlineRefs", () => {
  it("참조 없는 마크다운 → 변경 없음", () => {
    const md = "hello world";
    expect(replaceInlineRefs(md, new Map())).toBe(md);
  });

  it("단일 참조 치환", () => {
    const md = "![](inline:abc12345)";
    const map = new Map([["abc12345", "data:image/png;base64,AAAA"]]);
    expect(replaceInlineRefs(md, map)).toBe(
      "![](data:image/png;base64,AAAA)",
    );
  });

  it("여러 참조 전부 치환", () => {
    const md = "![](inline:aaa) text ![alt](inline:bbb)";
    const map = new Map([
      ["aaa", "https://cdn.example.com/a.png"],
      ["bbb", "https://cdn.example.com/b.png"],
    ]);
    const result = replaceInlineRefs(md, map);
    expect(result).toBe(
      "![](https://cdn.example.com/a.png) text ![alt](https://cdn.example.com/b.png)",
    );
  });

  it("맵에 없는 참조 → 치환하지 않음", () => {
    const md = "![](inline:known) ![](inline:unknown)";
    const map = new Map([["known", "https://resolved.url"]]);
    const result = replaceInlineRefs(md, map);
    expect(result).toContain("https://resolved.url");
    expect(result).toContain("inline:unknown");
  });
});

describe("stripInlineImageRefs", () => {
  it("inline 참조 제거", () => {
    expect(stripInlineImageRefs("before ![](inline:abc) after")).toBe("before  after");
  });

  it("참조 없으면 원본 유지", () => {
    expect(stripInlineImageRefs("plain text")).toBe("plain text");
  });

  it("여러 참조 전부 제거", () => {
    const result = stripInlineImageRefs("![a](inline:x) middle ![b](inline:y)");
    expect(result).toBe("middle");
  });

  it("연속 줄바꿈 정리", () => {
    const result = stripInlineImageRefs("text\n\n\n\n![](inline:a)\n\n\n\nmore");
    expect(result).not.toContain("\n\n\n");
  });
});

describe("resolveSectionImages", () => {
  const cfg = (
    overrides: Partial<SectionFilter> & { id: string },
  ): SectionFilter => ({ enabled: true, renderAs: "paragraph", ...overrides });

  it("enabled paragraph 섹션의 inline 참조 → dataURL로 치환", async () => {
    const out = await resolveSectionImages(
      { body: "see ![](inline:abc12345)" },
      [cfg({ id: "body" })],
    );
    expect(out.body).toBe("see ![](data:image/png;abc12345)");
  });

  it("inline 없는 섹션 → 원본 유지", async () => {
    const out = await resolveSectionImages(
      { body: "no images here" },
      [cfg({ id: "body" })],
    );
    expect(out.body).toBe("no images here");
  });

  it("disabled / non-paragraph 섹션 → resolve 안 함", async () => {
    const sections = {
      off: "![](inline:abc12345)",
      list: "![](inline:abc12345)",
    };
    const out = await resolveSectionImages(sections, [
      cfg({ id: "off", enabled: false }),
      cfg({ id: "list", renderAs: "orderedList" }),
    ]);
    expect(out.off).toBe("![](inline:abc12345)");
    expect(out.list).toBe("![](inline:abc12345)");
  });

  it("blob 없는 참조 → 치환하지 않고 원본 마크다운 유지", async () => {
    const out = await resolveSectionImages(
      { body: "![](inline:missing)" },
      [cfg({ id: "body" })],
    );
    expect(out.body).toBe("![](inline:missing)");
  });

  it("입력 객체를 변형하지 않고 새 맵 반환", async () => {
    const input = { body: "![](inline:abc12345)" };
    const out = await resolveSectionImages(input, [cfg({ id: "body" })]);
    expect(input.body).toBe("![](inline:abc12345)");
    expect(out).not.toBe(input);
  });
});
