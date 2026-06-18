import { describe, it, expect } from "vitest";
import { buildAiDraftRequest } from "../buildAiDraftRequest";
import type { AiDraftSessionContext } from "../buildAiDraftPrompt";

const CTX: AiDraftSessionContext = {
  captureMode: "screenshot",
  locale: "ko",
  url: "https://example.com/page",
  pageTitle: "Example Page",
  enabledSections: [{ id: "description" }],
};

describe("buildAiDraftRequest", () => {
  it("modeImages=undefined + inline 없음 → images=undefined (런타임 에러 없음)", () => {
    const { images } = buildAiDraftRequest({
      ctx: CTX,
      modeImages: undefined,
      inlineImageDataUrls: [],
    });
    expect(images).toBeUndefined();
  });

  it("캡처 이미지 + inline 이미지 → 캡처 먼저, inline 뒤 순서로 concat", () => {
    const { images } = buildAiDraftRequest({
      ctx: CTX,
      modeImages: ["data:cap1"],
      inlineImageDataUrls: ["data:in1", "data:in2"],
    });
    expect(images).toEqual(["data:cap1", "data:in1", "data:in2"]);
  });

  it("modeImages=undefined + inline 있음 → inline만", () => {
    const { images } = buildAiDraftRequest({
      ctx: CTX,
      modeImages: undefined,
      inlineImageDataUrls: ["data:in1"],
    });
    expect(images).toEqual(["data:in1"]);
  });

  it("캡처만 있고 inline 없음 → 캡처만", () => {
    const { images } = buildAiDraftRequest({
      ctx: CTX,
      modeImages: ["data:cap1"],
      inlineImageDataUrls: [],
    });
    expect(images).toEqual(["data:cap1"]);
  });

  it("systemPrompt가 ctx.existingDraft를 반영", () => {
    const { systemPrompt } = buildAiDraftRequest({
      ctx: {
        ...CTX,
        existingDraft: {
          title: "t",
          sections: { description: "기존 본문 내용" },
        },
      },
      modeImages: undefined,
      inlineImageDataUrls: [],
    });
    expect(systemPrompt).toContain("기존 본문 내용");
  });
});
