import type { ProviderCapabilities } from "./ai-provider";
import { PROMPT_CAPS } from "./prompts/caps";

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
}): {
  systemPrompt: string;
  images: string[] | undefined;
  droppedImages: number;
} {
  const { caps, systemPrompt } = input;
  // 이미지를 못 받는 프로바이더는 애초에 실을 게 없다 — 이건 절삭이 아니라 미지원이라
  // droppedImages로 세지 않는다(고지할 손실이 아니다).
  if (!caps.supportsImages) {
    return { systemPrompt, images: undefined, droppedImages: 0 };
  }

  const limits = PROMPT_CAPS[caps.promptStyle];
  let remainingChars = limits.imageChars;
  const images: string[] = [];
  // 순서는 modeImages 먼저로 고정 — 프롬프트가 캡처 이미지를 1-based 인덱스로 지목하므로
  // 인라인을 앞세워 살리면 그 지목이 통째로 어긋난다. 대신 빠진 수를 호출부가 고지한다.
  const candidates = [...(input.modeImages ?? []), ...input.inlineImageDataUrls];
  for (const image of candidates) {
    if (images.length >= limits.images) break;
    if (image.length > remainingChars) continue;
    images.push(image);
    remainingChars -= image.length;
  }
  return {
    systemPrompt,
    images: images.length > 0 ? images : undefined,
    droppedImages: candidates.length - images.length,
  };
}
