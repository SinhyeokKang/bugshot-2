export type StyleDiffSegment = { text: string; changed: boolean };

// class 토큰 집합 diff: 한쪽에만 있는 토큰은 changed, 공통 토큰은 평문. 순서는 원본 보존.
export function diffClassTokens(
  before: string[],
  after: string[],
): { asIs: StyleDiffSegment[]; toBe: StyleDiffSegment[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    asIs: before.map((text) => ({ text, changed: !afterSet.has(text) })),
    toBe: after.map((text) => ({ text, changed: !beforeSet.has(text) })),
  };
}

// 마크다운 셀 메타문자(|·개행) 무력화 — 빌더의 escapeCell과 동일 규칙(비-segment 경로와 일관).
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// changed 토큰만 **볼드**로 감싸 공백으로 join (마크다운 계열 공용).
export function segmentsToMarkdown(segs: StyleDiffSegment[]): string {
  return segs
    .map((s) => {
      const text = escapeCell(s.text);
      return s.changed ? `**${text}**` : text;
    })
    .join(" ");
}
