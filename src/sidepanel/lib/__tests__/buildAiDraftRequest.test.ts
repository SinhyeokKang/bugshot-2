import { describe, it, expect } from "vitest";
import { buildAiDraftRequest } from "../buildAiDraftRequest";
import { buildAiDraftSessionPrompt } from "../buildAiDraftPrompt";
import type { AiDraftSessionContext } from "../buildAiDraftPrompt";
import { BYOK_CAPABILITIES, NANO_CAPABILITIES } from "../ai-provider";

const CTX: AiDraftSessionContext = {
  caps: BYOK_CAPABILITIES,
  captureMode: "screenshot",
  locale: "ko",
  url: "https://example.com/page",
  pageTitle: "Example Page",
  enabledSections: [{ id: "description" }],
};

const SYS = "system prompt";

describe("buildAiDraftRequest", () => {
  it("modeImages=undefined + inline 없음 → images=undefined (런타임 에러 없음)", () => {
    const { images } = buildAiDraftRequest({
      caps: BYOK_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: undefined,
      inlineImageDataUrls: [],
    });
    expect(images).toBeUndefined();
  });

  // cap에 걸려 빠진 이미지는 호출부가 사용자에게 고지해야 한다 — 프롬프트는 modeImages를
  // 1-based 인덱스로 지목하므로 순서를 바꿔 인라인을 살릴 수는 없다(지목이 어긋난다).
  it("cap에 걸려 빠진 이미지 수를 droppedImages로 알린다", () => {
    const { images, droppedImages } = buildAiDraftRequest({
      caps: BYOK_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: Array.from({ length: 8 }, (_, i) => `data:cap${i}`),
      inlineImageDataUrls: ["data:inline0", "data:inline1"],
    });

    expect(images).toHaveLength(8);
    expect(droppedImages).toBe(2);
  });

  it("전부 실렸으면 droppedImages=0", () => {
    const { droppedImages } = buildAiDraftRequest({
      caps: BYOK_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: ["data:cap1"],
      inlineImageDataUrls: ["data:in1"],
    });
    expect(droppedImages).toBe(0);
  });

  it("이미지를 못 받는 프로바이더면 실을 게 없으니 droppedImages=0", () => {
    const { images, droppedImages } = buildAiDraftRequest({
      caps: NANO_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: ["data:cap1"],
      inlineImageDataUrls: ["data:in1"],
    });
    expect(images).toBeUndefined();
    expect(droppedImages).toBe(0);
  });

  it("캡처 이미지 + inline 이미지 → 캡처 먼저, inline 뒤 순서로 concat", () => {
    const { images } = buildAiDraftRequest({
      caps: BYOK_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: ["data:cap1"],
      inlineImageDataUrls: ["data:in1", "data:in2"],
    });
    expect(images).toEqual(["data:cap1", "data:in1", "data:in2"]);
  });

  it("modeImages=undefined + inline 있음 → inline만", () => {
    const { images } = buildAiDraftRequest({
      caps: BYOK_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: undefined,
      inlineImageDataUrls: ["data:in1"],
    });
    expect(images).toEqual(["data:in1"]);
  });

  it("캡처만 있고 inline 없음 → 캡처만", () => {
    const { images } = buildAiDraftRequest({
      caps: BYOK_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: ["data:cap1"],
      inlineImageDataUrls: [],
    });
    expect(images).toEqual(["data:cap1"]);
  });

  it("systemPrompt가 ctx.existingDraft를 반영", () => {
    const { systemPrompt } = buildAiDraftRequest({
      caps: BYOK_CAPABILITIES,
      systemPrompt: buildAiDraftSessionPrompt({
        ...CTX,
        existingDraft: { title: "t", sections: { description: "기존 본문 내용" } },
      }),
      modeImages: undefined,
      inlineImageDataUrls: [],
    });
    expect(systemPrompt).toContain("기존 본문 내용");
  });

  // 회귀 재현: Chrome 세션은 options.images를 읽지도 않는데 이미지를 만들어 넘기고
  // 있었다. 프롬프트는 "스크린샷을 분석하라"고 지시 → 환각.
  it("supportsImages=false + 캡처 이미지 있음 → images=undefined (전송 안 함)", () => {
    const { images } = buildAiDraftRequest({
      caps: NANO_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: ["data:cap1"],
      inlineImageDataUrls: ["data:in1"],
    });
    expect(images).toBeUndefined();
  });

  it("supportsImages=false + 이미지 없음 → images=undefined", () => {
    const { images } = buildAiDraftRequest({
      caps: NANO_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: undefined,
      inlineImageDataUrls: [],
    });
    expect(images).toBeUndefined();
  });

  it("supportsImages=true → 기존 concat 동작 유지", () => {
    const { images } = buildAiDraftRequest({
      caps: BYOK_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: ["data:cap1"],
      inlineImageDataUrls: ["data:in1"],
    });
    expect(images).toEqual(["data:cap1", "data:in1"]);
  });

  it("mode와 inline을 합친 최종 이미지에 rich 전역 개수 cap을 적용", () => {
    const { images } = buildAiDraftRequest({
      caps: BYOK_CAPABILITIES,
      systemPrompt: SYS,
      modeImages: Array.from({ length: 6 }, (_, i) => `data:cap${i}`),
      inlineImageDataUrls: Array.from(
        { length: 4 },
        (_, i) => `data:inline${i}`,
      ),
    });

    expect(images).toEqual([
      "data:cap0",
      "data:cap1",
      "data:cap2",
      "data:cap3",
      "data:cap4",
      "data:cap5",
      "data:inline0",
      "data:inline1",
    ]);
  });
});
