export const CODE_COLLAPSE_LINE_THRESHOLD = 15;

// markdown-it은 <code> 본문 끝에 개행을 붙이고 ProseMirror의 textContent는 안 붙인다 —
// 후행 개행 1개만 지워야 두 표면이 같은 블럭에 같은 숫자를 낸다.
export function countCodeLines(text: string): number {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").length;
}

export function shouldCollapseCode(lineCount: number): boolean {
  return lineCount > CODE_COLLAPSE_LINE_THRESHOLD;
}
