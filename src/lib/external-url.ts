// logs.html은 확장 페이지가 아니라 CSP가 없고 React도 javascript: href를 막지 않는다.
// 외부 URL을 href로 흘리는 지점의 단일 게이트 — 앵커 고정이라 선행 공백·제어문자도 거부(fail-closed).
const SAFE_EXTERNAL_URL_RE = /^https?:\/\//i;

export function isSafeExternalUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return SAFE_EXTERNAL_URL_RE.test(url);
}

export function safeExternalHref(url: string | undefined | null): string | undefined {
  return isSafeExternalUrl(url) ? (url as string) : undefined;
}
