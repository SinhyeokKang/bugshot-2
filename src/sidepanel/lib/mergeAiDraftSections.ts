import { extractInlineImageMarkdown } from "./resolveInlineImages";

// LLM 텍스트 응답을 적용하되 기존 섹션의 inline 이미지는 보존한다.
// 보존된 이미지는 섹션 상단에, 그 아래 빈 줄로 구분해 LLM 텍스트가 온다.
//
// promptedSections = 그 섹션의 기존 내용이 실제로 프롬프트에 실린 섹션 id들.
// 나노는 responseConstraint가 모든 키를 강제하므로, 절삭으로 못 본 섹션에도 ""를
// 채워 반환한다 — 그걸 "비우기 의도"로 읽으면 사용자 텍스트가 조용히 삭제된다.
// 따라서 빈 문자열은 프롬프트에 실렸던 섹션에서만 비우기로 인정한다.
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
    const images = extractInlineImageMarkdown(prevSections[id] ?? "");
    const aiText = (aiSections[id] ?? "").trim();
    const clears = id in aiSections && !aiText && prompted.has(id);

    // AI가 키를 누락했거나, 못 본 섹션에 ""를 채워 보낸 경우 → 기존 내용 보존.
    if (!aiText && !clears) {
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
