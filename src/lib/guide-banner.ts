// 가이드 배너 재팝업 판정 (순수 함수, 테스트 대상).
// minor+ 업데이트 시 재노출, patch/동일/하락은 숨김 유지.
// 파싱 실패는 fail-closed(false, 나그 방지). 단 dismissed === null이면 true 우선.

function parseMajorMinor(
  version: string,
): { major: number; minor: number } | null {
  const core = version.trim().replace(/^v/, "").split("-")[0];
  const parts = core.split(".");
  if (parts.length !== 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  return { major: Number(parts[0]), minor: Number(parts[1]) };
}

export function shouldShowGuideBanner(
  dismissedVersion: string | null,
  currentVersion: string,
): boolean {
  if (dismissedVersion === null) return true;
  const dismissed = parseMajorMinor(dismissedVersion);
  const current = parseMajorMinor(currentVersion);
  if (!dismissed || !current) return false;
  if (current.major !== dismissed.major) return current.major > dismissed.major;
  return current.minor > dismissed.minor;
}
