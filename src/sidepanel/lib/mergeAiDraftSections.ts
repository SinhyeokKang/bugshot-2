import {
  extractInlineImageMarkdown,
  stripInlineImageRefs,
} from "./resolveInlineImages";

// LLM 텍스트 응답을 적용하되 기존 섹션의 inline 이미지는 보존한다.
// 보존된 이미지는 섹션 상단에, 그 아래 빈 줄로 구분해 LLM 텍스트가 온다.
//
// promptedSections = 그 섹션의 기존 내용이 실제로 프롬프트에 실린 섹션 id들
// (`selectDraftSections`가 단일 출처). 프롬프트에 안 실렸는데 prev에 원문이 있다면
// 예산 절삭으로 빠진 섹션이다 — 모델은 그 원문을 본 적이 없으므로, ""든 새로 지어낸
// 텍스트든 "개선 결과"가 아니다. 어느 쪽도 사용자 원문을 대체하지 못한다.
//
// "원문 있음" 판정은 `selectDraftSections`와 **같은 기준**(이미지 ref를 뺀 텍스트)이어야
// 한다. 이미지만 있는 섹션은 애초에 프롬프트에 안 실리므로, raw 기준으로 재면 그것까지
// "절삭된 원문"으로 오인해 AI 본문을 통째로 버린다.
export function mergeAiSectionsPreservingImages(
  prevSections: Record<string, string>,
  aiSections: Record<string, string>,
  promptedSections: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const prompted = new Set(promptedSections);
  const ids = new Set([
    ...Object.keys(aiSections),
    ...Object.keys(prevSections),
  ]);

  for (const id of ids) {
    const prev = prevSections[id] ?? "";

    if (!prompted.has(id) && stripInlineImageRefs(prev).trim()) {
      out[id] = prev;
      continue;
    }

    const images = extractInlineImageMarkdown(prev);
    const aiText = (aiSections[id] ?? "").trim();

    // AI가 키를 누락한 경우 → 기존 내용 보존.
    if (!aiText && !(id in aiSections)) {
      if (prevSections[id] !== undefined) out[id] = prevSections[id];
      continue;
    }

    if (images.length === 0) {
      out[id] = aiText;
      continue;
    }

    out[id] = [...images, aiText].filter(Boolean).join("\n\n");
  }

  return out;
}
