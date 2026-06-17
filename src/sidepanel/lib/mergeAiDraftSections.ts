import { extractInlineImageMarkdown } from "./resolveInlineImages";

// LLM 텍스트 응답을 적용하되 기존 섹션의 inline 이미지는 보존한다.
// 보존된 이미지는 섹션 상단에, 그 아래 빈 줄로 구분해 LLM 텍스트가 온다.
// 결과 키 = aiSections의 모든 키 ∪ prevSections 중 이미지가 있는 키.
export function mergeAiSectionsPreservingImages(
  prevSections: Record<string, string>,
  aiSections: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const ids = new Set([
    ...Object.keys(aiSections),
    ...Object.keys(prevSections),
  ]);

  for (const id of ids) {
    const images = extractInlineImageMarkdown(prevSections[id] ?? "");
    const aiText = (aiSections[id] ?? "").trim();

    if (images.length === 0) {
      if (id in aiSections) out[id] = aiSections[id] ?? "";
      continue;
    }

    out[id] = [...images, aiText].filter(Boolean).join("\n\n");
  }

  return out;
}
