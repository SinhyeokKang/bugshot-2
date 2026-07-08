// 외부 store→doc 재동기화(doc 통째 교체)를 강행할지 판정. 평시엔 포커스 중 교체를 피해
// 타이핑 커서 튐·늦은 cross-origin specified 보강 충돌을 막지만, AI 스타일 적용 직후엔
// 포커스 중이어도 강행한다 — 사용자가 명시 요청한 변경이라 정합성이 커서 보존보다 우선이고,
// 스킵하면 다음 타이핑이 stale doc 기준으로 AI가 넣은 값을 조용히 덮어쓴다.
export function shouldResyncDoc(opts: {
  focused: boolean;
  aiApplied: boolean;
}): boolean {
  return opts.aiApplied || !opts.focused;
}
