import type { ProviderCapabilities } from "./ai-provider";

// LLM 요청(systemPrompt + 최종 images)을 결정적으로 조립하는 순수 함수.
// systemPrompt는 예산 절삭을 거친 본문을 호출부가 그대로 넘긴다 — 여기서 다시 빌드하면
// 절삭 사다리가 태운 build()를 한 번 더 도는 낭비다.
// inline 이미지 blob→dataURL resolve(비순수)도 호출부가 먼저 수행해 결과만 넘긴다.
// 이미지를 못 받는 프로바이더에는 아예 싣지 않는다 — 실으면 조용히 버려지는데
// 프롬프트만 "이미지를 분석하라"고 지시해 환각이 된다.
export function buildAiDraftRequest(input: {
  caps: ProviderCapabilities;
  systemPrompt: string;
  modeImages: string[] | undefined;
  inlineImageDataUrls: string[];
}): { systemPrompt: string; images: string[] | undefined } {
  const { caps, systemPrompt } = input;
  if (!caps.supportsImages) return { systemPrompt, images: undefined };

  const images = [...(input.modeImages ?? []), ...input.inlineImageDataUrls];
  return { systemPrompt, images: images.length > 0 ? images : undefined };
}
