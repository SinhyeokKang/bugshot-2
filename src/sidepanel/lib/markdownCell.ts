// 마크다운 표 셀 메타문자(|·개행) 무력화 — 이슈 본문 빌더 6곳 공용 단일 출처.
export function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
