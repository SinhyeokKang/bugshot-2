/**
 * 프로그램매틱 dialog open 시 focused element가 root에 남아 있으면 Radix의 aria-hidden과
 * 충돌해 a11y 경고가 뜬다 — 여는 쪽이 미리 blur한다 (DESIGN.md §9).
 */
export function blurActiveElement(): void {
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
}
