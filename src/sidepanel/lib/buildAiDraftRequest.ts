import {
  buildAiDraftSessionPrompt,
  type AiDraftSessionContext,
} from "./buildAiDraftPrompt";

// LLM 요청(systemPrompt + 최종 images)을 결정적으로 조립하는 순수 함수.
// inline 이미지 blob→dataURL resolve(비순수)는 호출부가 먼저 수행해 결과만 넘긴다.
// 이미지를 못 받는 프로바이더(Chrome 나노)에는 아예 싣지 않는다 — 실으면 조용히
// 버려지는데 프롬프트만 "이미지를 분석하라"고 지시해 환각이 된다.
export function buildAiDraftRequest(input: {
  ctx: AiDraftSessionContext;
  modeImages: string[] | undefined;
  inlineImageDataUrls: string[];
}): { systemPrompt: string; images: string[] | undefined } {
  const systemPrompt = buildAiDraftSessionPrompt(input.ctx);
  if (!input.ctx.caps.supportsImages) return { systemPrompt, images: undefined };

  const images = [...(input.modeImages ?? []), ...input.inlineImageDataUrls];
  return { systemPrompt, images: images.length > 0 ? images : undefined };
}
