import { describe, expect, it } from "vitest";
import {
  BYOK_CAPABILITIES,
  NANO_CAPABILITIES,
  type ProviderCapabilities,
} from "../../ai-provider";
import type { AiDraftSessionContext } from "../../buildAiDraftPrompt";
import {
  describeAiDraftElementImages,
  resolveAiDraftStyleElements,
  selectAiDraftTokens,
} from "../draftStyleElements";

function ctx(
  caps: ProviderCapabilities,
  overrides: Partial<AiDraftSessionContext> = {},
): AiDraftSessionContext {
  return {
    caps,
    captureMode: "element",
    locale: "ko",
    url: "https://example.com",
    pageTitle: "Example",
    enabledSections: [{ id: "description" }],
    ...overrides,
  };
}

const element = (index: number) => ({
  selector: `.item-${index}`,
  tagName: "div",
  frameId: 0,
  diffs: [{ prop: `prop-${index}`, asIs: "a", toBe: "b" }],
});

describe("resolveAiDraftStyleElements", () => {
  it("compact도 모든 변경 요소 selector를 유지", () => {
    const resolved = resolveAiDraftStyleElements(
      ctx(NANO_CAPABILITIES, {
        styleElements: Array.from({ length: 5 }, (_, i) => element(i)),
      }),
    );

    expect(resolved.map((item) => item.selector)).toEqual(
      Array.from({ length: 5 }, (_, i) => `.item-${i}`),
    );
  });

  it("legacy 단일 selector/tagName/diffs를 1개 요소로 정규화", () => {
    expect(
      resolveAiDraftStyleElements(
        ctx(BYOK_CAPABILITIES, {
          selector: "button.cta",
          tagName: "button",
          diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
        }),
      ),
    ).toEqual([
      {
        selector: "button.cta",
        tagName: "button",
        diffs: [{ prop: "color", asIs: "#000", toBe: "#fff" }],
      },
    ]);
  });

  it("이미지 미지원 capability면 이미지 데이터를 제거", () => {
    const resolved = resolveAiDraftStyleElements(
      ctx({ ...NANO_CAPABILITIES, promptStyle: "rich" }, {
        styleElements: [{
          ...element(0),
          beforeImage: "data:before",
          afterImage: "data:after",
        }],
      }),
    );

    expect(resolved[0].beforeImage).toBeUndefined();
    expect(resolved[0].afterImage).toBeUndefined();
  });

  it("rich 이미지 cap을 개수와 전체 문자 수에 적용", () => {
    const resolved = resolveAiDraftStyleElements(
      ctx(BYOK_CAPABILITIES, {
        styleElements: Array.from({ length: 6 }, (_, i) => ({
          ...element(i),
          beforeImage: `data:${"x".repeat(2_999_990)}`,
          afterImage: `data:${"y".repeat(2_999_990)}`,
        })),
      }),
    );

    const images = resolved.flatMap((item) =>
      [item.beforeImage, item.afterImage].filter(Boolean),
    );
    expect(images).toHaveLength(8);
  });
});

describe("describeAiDraftElementImages", () => {
  it("이미지가 없는 중간 요소와 단일 after를 건너뛰어 실제 전송 인덱스를 계산", () => {
    const elements = [
      { ...element(0), beforeImage: "data:before-0" },
      element(1),
      { ...element(2), afterImage: "data:after-2" },
    ];

    expect(describeAiDraftElementImages(elements, 0)).toBe("Image 1: before");
    expect(describeAiDraftElementImages(elements, 1)).toBeNull();
    expect(describeAiDraftElementImages(elements, 2)).toBe("Image 2: after");
  });
});

describe("selectAiDraftTokens", () => {
  const tokens = [{ name: "--color-primary", value: "#fff" }];
  const selection = { selector: ".item-0", frameId: 0 };

  it("단일 변경 요소가 현재 selection과 같을 때만 토큰을 유지", () => {
    expect(selectAiDraftTokens(tokens, [element(0)], selection)).toEqual(tokens);
  });

  it("복수 요소면 현재 selection 토큰의 잘못된 공통 귀속을 막기 위해 생략", () => {
    expect(
      selectAiDraftTokens(tokens, [element(0), element(1)], selection),
    ).toBeUndefined();
  });

  it("버퍼의 단일 변경 요소가 현재 selection과 다르면 토큰을 생략", () => {
    expect(
      selectAiDraftTokens(tokens, [element(0)], {
        selector: ".current-without-diff",
        frameId: 0,
      }),
    ).toBeUndefined();
  });
});

// 접는 지점은 소비처다. 여기서 접지 않으면 캡 회계가 원본 길이로 돌고, 주석본은 rest 스프레드로
// 캡을 우회해 그대로 실린다(캡 초과 이미지가 조용히 통과).
describe("resolveAiDraftStyleElements — diff 이미지 주석 resolve(annotated ?? raw)", () => {
  it("주석이 있으면 주석본을 싣는다", () => {
    const [resolved] = resolveAiDraftStyleElements(
      ctx(BYOK_CAPABILITIES, {
        styleElements: [
          {
            ...element(0),
            beforeImage: "data:before",
            afterImage: "data:after",
            beforeAnnotated: "data:before-ann",
            afterAnnotated: "data:after-ann",
          },
        ] as never,
      }),
    );

    expect(resolved.beforeImage).toBe("data:before-ann");
    expect(resolved.afterImage).toBe("data:after-ann");
  });

  it("주석이 없으면 원본을 싣는다", () => {
    const [resolved] = resolveAiDraftStyleElements(
      ctx(BYOK_CAPABILITIES, {
        styleElements: [
          { ...element(0), beforeImage: "data:before", afterImage: "data:after" },
        ] as never,
      }),
    );

    expect(resolved.beforeImage).toBe("data:before");
    expect(resolved.afterImage).toBe("data:after");
  });

  it("결과에 annotated 원본 필드가 남지 않는다 — 캡을 우회하는 두 번째 경로를 만들지 않는다", () => {
    const [resolved] = resolveAiDraftStyleElements(
      ctx(BYOK_CAPABILITIES, {
        styleElements: [
          {
            ...element(0),
            beforeImage: "data:before",
            beforeAnnotated: "data:before-ann",
          },
        ] as never,
      }),
    );

    expect("beforeAnnotated" in resolved).toBe(false);
    expect("afterAnnotated" in resolved).toBe(false);
  });

  it("주석본이 imageChars 캡을 넘으면 접힌 뒤 탈락한다", () => {
    const huge = `data:${"x".repeat(7_000_000)}`;
    const [resolved] = resolveAiDraftStyleElements(
      ctx(NANO_CAPABILITIES, {
        styleElements: [
          { ...element(0), beforeImage: "data:before", beforeAnnotated: huge },
        ] as never,
      }),
    );

    expect(resolved.beforeImage).toBeUndefined();
  });
});
