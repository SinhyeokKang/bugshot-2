import { stripInlineImageRefs } from "./resolveInlineImages";

// 들여쓰기 0의 fence만 취급한다 — neutralizeFences가 본문 내 백틱 런을 4칸 들여쓰므로
// (logToCodeBlock.ts) 내부 fence는 여기 안 걸린다. 미닫힘 fence는 텍스트 취급.
const FENCE_OPEN = /^`{3,}/;
const FENCE_CLOSE = /^`{3,}\s*$/;

export function extractCodeBlocks(markdown: string): string[] {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1) {
      if (FENCE_OPEN.test(lines[i])) start = i;
    } else if (FENCE_CLOSE.test(lines[i])) {
      blocks.push(lines.slice(start, i + 1).join("\n"));
      start = -1;
    }
  }
  return blocks;
}

export function stripCodeBlocks(markdown: string): string {
  const lines = markdown.split("\n");
  const kept: string[] = [];
  let buffer: string[] | null = null;
  for (const line of lines) {
    if (buffer === null) {
      if (FENCE_OPEN.test(line)) buffer = [line];
      else kept.push(line);
    } else {
      buffer.push(line);
      if (FENCE_CLOSE.test(line)) buffer = null;
    }
  }
  if (buffer) kept.push(...buffer);
  return kept.join("\n");
}

// 병합 시 보존되는 것(이미지 + 코드블럭)을 뺀 "사용자가 쓴 산문" — selectDraftSections와
// merge가 공유하는 단일 기준. stripInlineImageRefs의 빈 줄 접기 + trim 계약을 상속한다
// (selectDraftSections가 trim 없이 truthy로만 판정하므로 "\n\n"을 남기면 빈 섹션이
// 프롬프트에 실리고 merge 보호 가드가 풀린다).
export function stripPreservedContent(markdown: string): string {
  return stripInlineImageRefs(stripCodeBlocks(markdown));
}
