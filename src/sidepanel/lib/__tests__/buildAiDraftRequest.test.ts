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
});
