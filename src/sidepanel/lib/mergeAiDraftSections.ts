import { extractInlineImageMarkdown } from "./resolveInlineImages";
import { extractCodeBlocks, stripPreservedContent } from "./markdownBlocks";
import { neutralizeFences } from "./logToCodeBlock";

// LLM 텍스트 응답을 적용하되 기존 섹션의 inline 이미지와 코드블럭은 보존한다.
// 보존물은 이미지(상단) → LLM 텍스트 → 코드블럭(하단) 순, 빈 줄 구분.
// 코드블럭은 출처를 가리지 않는다 — 삽입된 로그와 손으로 친 블럭은 마크다운상 구분 불가.
//
// promptedSections = 그 섹션의 기존 내용이 실제로 프롬프트에 실린 섹션 id들
// (`selectDraftSections`가 단일 출처). 프롬프트에 안 실렸는데 prev에 원문이 있다면
// 예산 절삭으로 빠진 섹션이다 — 모델은 그 원문을 본 적이 없으므로, ""든 새로 지어낸
// 텍스트든 "개선 결과"가 아니다. 어느 쪽도 사용자 원문을 대체하지 못한다.
//
// "원문 있음" 판정은 `selectDraftSections`와 **같은 기준**(보존물을 뺀 산문 —
// stripPreservedContent)이어야 한다. 이미지·코드블럭만 있는 섹션은 애초에 프롬프트에 안
// 실리므로, raw 기준으로 재면 그것까지 "절삭된 원문"으로 오인해 AI 본문을 통째로 버린다.
export function mergeAiSectionsPreservingBlocks(
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

    if (!prompted.has(id) && stripPreservedContent(prev)) {
      out[id] = prev;
      continue;
    }

    const images = extractInlineImageMarkdown(prev);
    const codeBlocks = extractCodeBlocks(prev);
    // AI 산문의 fence는 무해화한다 — 미닫힘 fence가 뒤에 붙는 보존 블록의 여는 fence를
    // 닫힘으로 삼켜 로그 원문(페이지 통제 가능)이 산문으로 새는 걸 막는다. 로그는 refs로만
    // 들어오므로 산문 fence는 설계상 없어야 한다.
    const aiText = neutralizeFences((aiSections[id] ?? "").trim());

    // AI가 키를 누락한 경우 → 기존 내용 보존.
    if (!aiText && !(id in aiSections)) {
      if (prevSections[id] !== undefined) out[id] = prevSections[id];
      continue;
    }

    out[id] = [...images, aiText, ...codeBlocks].filter(Boolean).join("\n\n");
  }

  return out;
}
