import type { TokenCategory } from "@/types/picker";
import { expandShortHex, normalizeHexInput } from "./hexUtils";
import { isTokenValue } from "./tokenUtils";

const LENGTH_NUMBER_RE = /^-?(\d+(\.\d+)?|\.\d+)$/;

// 라이브·커밋 공용 값 정규화. color는 hex 정규화·확장, length 순수 숫자는 px 부착,
// 그 외(calc/var/단위값/부분입력)는 그대로 통과해 무효값 오염을 막는다.
export function finalizeValue(
  category: TokenCategory | undefined,
  next: string,
): string {
  if (category === "color") {
    const normalized = normalizeHexInput(next);
    return expandShortHex(normalized) ?? normalized;
  }
  if (category === "length" && LENGTH_NUMBER_RE.test(next)) {
    return `${next}px`;
  }
  return next;
}

export function shortValue(v: string): string {
  if (v.endsWith("px")) {
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return `${n}`;
  }
  return v;
}

// 트리거 우측 미리보기 텍스트. color/image 토큰은 원시값(드롭다운과 일관).
// length/number는 토큰 참조면 토큰 정의값(원시값) 우선 — computed는 편집 전
// baseline에 고정돼 토큰 변경 시 stale하기 때문. 직접값은 computed로 폴백.
export function rightHintText(
  category: TokenCategory | undefined,
  computed: string,
  tokenRawValue: string | undefined,
  compact: boolean,
): string | null {
  if (category === "color" || category === "image") {
    return tokenRawValue ?? null;
  }
  if (category === "length" || category === "number") {
    if (tokenRawValue) return compact ? shortValue(tokenRawValue) : tokenRawValue;
    if (!computed || isTokenValue(computed)) return null;
    return compact ? shortValue(computed) : computed;
  }
  return null;
}
