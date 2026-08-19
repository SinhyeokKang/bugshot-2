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
  extractInlineImageMarkdown,
  replaceInlineRefs,
  stripInlineImageRefs,
  resolveSectionImages,
  placeholderInlineImages,
  placeholderSectionImages,
  type SectionFilter,
} from "../resolveInlineImages";

describe("extractInlineImageMarkdown", () => {
  it("inline 이미지 없는 마크다운 → 빈 배열", () => {
    expect(extractInlineImageMarkdown("hello world")).toEqual([]);
  });

  it("일반(외부 URL) 이미지는 제외", () => {
    expect(
      extractInlineImageMarkdown("![](https://example.com/img.png)"),
    ).toEqual([]);
  });

  it("inline 이미지 1개 → alt 빈 마크다운 통째 반환", () => {
    expect(extractInlineImageMarkdown("![](inline:abc12345)")).toEqual([
      "![](inline:abc12345)",
    ]);
  });

  it("alt 보존", () => {
    expect(extractInlineImageMarkdown("![bug shot](inline:abc12345)")).toEqual([
      "![bug shot](inline:abc12345)",
    ]);
  });

  it("여러 개 → 등장 순서 유지", () => {
    const md = "![first](inline:a1)\n\ntext\n\n![second](inline:b2)";
    expect(extractInlineImageMarkdown(md)).toEqual([
      "![first](inline:a1)",
      "![second](inline:b2)",
    ]);
  });

  it("중복 ref도 각각 보존(중복 제거 안 함)", () => {
    const md = "![](inline:a1) ![](inline:a1)";
    expect(extractInlineImageMarkdown(md)).toEqual([
      "![](inline:a1)",
      "![](inline:a1)",
    ]);
  });

  it("텍스트 사이에 섞인 이미지도 모두 추출", () => {
    const md = "intro ![x](inline:a1) middle ![y](inline:b2) end";
    expect(extractInlineImageMarkdown(md)).toEqual([
      "![x](inline:a1)",
      "![y](inline:b2)",
    ]);
  });
});

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

// ─────────────────────────────────────────────────────────────────────────────
// 클립보드 복사용 인라인 이미지 처리
//
// data: URI 이미지가 클립보드 text/html에 하나라도 있으면 Notion·Slack·Jira가 붙여넣기를
// 통째로 거부한다(본문 전체 유실 — 이미지만 빠지는 게 아니다). 실측으로 크기와 무관하고
// data: 자체가 원인임을 확인했다. BugShot은 클라이언트 온리라 호스팅 URL을 만들 수 없으므로
// 복사 경로에서는 이미지를 포기하고 본문을 살린다. stripInlineImageRefs(통째 삭제)와 달리
// 흔적을 남기는 이유는, 무음 유실이 이 버그의 실패 모드였기 때문이다.
//
// 문구를 인자로 받는다 — 이 모듈이 i18n에 의존하지 않게 두려는 것이다(호출부가 t()로 만든다).
// ─────────────────────────────────────────────────────────────────────────────
describe("placeholderInlineImages", () => {
  const PH = "(image omitted)";

  it("inline 참조를 플레이스홀더로 바꾼다", () => {
    expect(placeholderInlineImages("before ![shot](inline:a) after", PH)).toBe(
      `before ${PH} after`,
    );
  });

  it("여러 참조를 각각 바꾼다", () => {
    const out = placeholderInlineImages("![a](inline:x)\n![b](inline:y)", PH);

    expect(out).toBe(`${PH}\n${PH}`);
    expect(out).not.toContain("inline:");
  });

  it("참조가 없으면 원문 그대로다", () => {
    const src = "just text with [a link](https://example.com)";

    expect(placeholderInlineImages(src, PH)).toBe(src);
  });

  it("일반 이미지 링크(inline: 아님)는 건드리지 않는다", () => {
    const src = "![logo](https://cdn.example.com/a.png)";

    expect(placeholderInlineImages(src, PH)).toBe(src);
  });

  // 이 함수가 도는 이유 자체 — 결과에 data: 이미지가 없어야 한다.
  it("결과에 data: 이미지가 남지 않는다", () => {
    const out = placeholderInlineImages("![a](inline:x) ![b](inline:y)", PH);

    expect(out).not.toContain("data:image");
    expect(out).not.toContain("](inline:");
  });
});

describe("placeholderSectionImages", () => {
  const cfg = (
    overrides: Partial<SectionFilter> & { id: string },
  ): SectionFilter => ({ enabled: true, renderAs: "paragraph", ...overrides });
  const PH = "(image omitted)";

  it("enabled paragraph 섹션의 inline 참조를 플레이스홀더로 바꾼다", () => {
    const out = placeholderSectionImages(
      { description: "a ![s](inline:r1) b" },
      [cfg({ id: "description" })],
      PH,
    );

    expect(out.description).toBe(`a ${PH} b`);
  });

  // resolveSectionImages와 같은 게이트를 타야 한다 — 여기서 갈리면 복사본과 제출본의
  // 섹션 처리 범위가 어긋난다.
  it("disabled·비paragraph 섹션은 건드리지 않는다", () => {
    const sections = {
      off: "![a](inline:r1)",
      list: "![b](inline:r2)",
    };
    const out = placeholderSectionImages(
      sections,
      [cfg({ id: "off", enabled: false }), cfg({ id: "list", renderAs: "orderedList" })],
      PH,
    );

    expect(out.off).toBe(sections.off);
    expect(out.list).toBe(sections.list);
  });

  it("참조가 없는 섹션은 원문 그대로다", () => {
    const out = placeholderSectionImages(
      { description: "plain text" },
      [cfg({ id: "description" })],
      PH,
    );

    expect(out.description).toBe("plain text");
  });

  it("동기 함수다 — IndexedDB 왕복이 없어야 한다(gesture window 보존)", () => {
    const out = placeholderSectionImages(
      { description: "![a](inline:r1)" },
      [cfg({ id: "description" })],
      PH,
    );

    expect(out).not.toBeInstanceOf(Promise);
    expect(out.description).toBe(PH);
  });
});
