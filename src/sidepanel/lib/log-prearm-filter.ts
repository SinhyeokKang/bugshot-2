// reload는 logClear → lastLogClearAt 세팅 → 그 전 타임스탬프 엔트리를 머지에서 폐기한다.
// pre-arm 초반 로그는 정의상 그 경계보다 과거라, preArm 마커가 붙은 엔트리는 우회 보존한다.
export function shouldDropPreArmEntry(
  timestamp: number,
  lastLogClearAt: number,
  isPreArm: boolean,
): boolean {
  return lastLogClearAt > 0 && !isPreArm && timestamp < lastLogClearAt;
}
