import { originOf } from "@/lib/session-keys";

// null/opaque origin(빈 pageUrl·about:blank·srcdoc·sandboxed) 묶음 키. 라벨은 호출부가 i18n으로 치환.
export const UNKNOWN_ORIGIN = "__unknown__";

// 필터 그룹 키: 유효 origin이면 그대로, opaque("null")·빈 값이면 unknown 그룹.
export function originKey(pageUrl: string): string {
  const o = originOf(pageUrl);
  if (o === null || o === "null") return UNKNOWN_ORIGIN;
  return o;
}

// distinct origin 키 목록(첫 등장 순서 보존). entries가 시간순이라 top-page-origin이 자연히 앞에 온다.
export function distinctOriginKeys(pageUrls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of pageUrls) {
    const k = originKey(url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

// origin 키별 개수(필터 버튼 배지용).
export function originCounts(pageUrls: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const url of pageUrls) {
    const k = originKey(url);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// 버튼 라벨용 호스트명(좁은 폭). unknown 키는 빈 문자열 — 호출부가 i18n 라벨로 대체.
export function originHostLabel(key: string): string {
  if (key === UNKNOWN_ORIGIN) return "";
  try {
    return new URL(key).host;
  } catch {
    return key;
  }
}
