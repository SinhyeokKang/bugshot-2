import {
  buildAiDraftSessionPrompt,
  type AiDraftSessionContext,
} from "./buildAiDraftPrompt";

// LLM 요청(systemPrompt + 최종 images)을 결정적으로 조립하는 순수 함수.
// inline 이미지 blob→dataURL resolve(비순수)는 호출부가 먼저 수행해 결과만 넘긴다.
export function buildAiDraftRequest(input: {
  ctx: AiDraftSessionContext;
  modeImages: string[] | undefined;
  inlineImageDataUrls: string[];
}): { systemPrompt: string; images: string[] | undefined } {
  const systemPrompt = buildAiDraftSessionPrompt(input.ctx);
  const images = [...(input.modeImages ?? []), ...input.inlineImageDataUrls];
  return { systemPrompt, images: images.length > 0 ? images : undefined };
}
