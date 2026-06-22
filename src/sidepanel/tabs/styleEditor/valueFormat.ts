import type { TokenCategory } from "@/types/picker";
import { expandShortHex, normalizeHexInput } from "./hexUtils";
import { isTokenValue } from "./tokenUtils";

const LENGTH_NUMBER_RE = /^-?(\d+(\.\d+)?|\.\d+)$/;

// unitless가 표준인 length-like prop — px 자동부착에서 제외한다. line-height에
// unitless 1.5(= 1.5×font-size)를 입력하면 1.5px로 변질돼 줄간격이 붕괴하던 버그 방지.
const UNITLESS_LENGTH_PROPS = new Set(["line-height"]);

// 커밋·blur 값 정규화. color는 hex 정규화·확장(단축 hex 포함), length 순수 숫자는
// px 부착(unitless 허용 prop 제외), 그 외(calc/var/단위값/부분입력)는 그대로 통과.
export function finalizeValue(
  category: TokenCategory | undefined,
  next: string,
  prop?: string,
): string {
  if (category === "color") {
    const normalized = normalizeHexInput(next);
    return expandShortHex(normalized) ?? normalized;
  }
  if (
    category === "length" &&
    LENGTH_NUMBER_RE.test(next) &&
    !(prop && UNITLESS_LENGTH_PROPS.has(prop))
  ) {
    return `${next}px`;
  }
  return next;
}

// 라이브(타이핑 중) 정규화. color 단축 hex(2/3/4자리)는 확장하지 않아(blur 시에만
// expandShortHex 적용) 입력 도중 매 키마다 색이 점프하는 깜빡임을 막는다. 그 외는 동일.
export function finalizeLiveValue(
  category: TokenCategory | undefined,
  next: string,
  prop?: string,
): string {
  if (category === "color") return normalizeHexInput(next);
  return finalizeValue(category, next, prop);
}

// 토큰 multiplier(calc(var(--x) * N)) 반영. raw가 단위값(8px)이면 N을 곱한 값(16px)을
// 돌려주고, calc 등 비단순값이거나 multiplier 부재면 raw 그대로.
export function applyMultiplier(
  raw: string | undefined,
  multiplier?: number,
): string | undefined {
  if (raw == null || multiplier == null) return raw;
  const m = raw.trim().match(/^(-?\d*\.?\d+)(.*)$/);
  if (!m) return raw;
  return `${parseFloat(m[1]) * multiplier}${m[2]}`;
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
