import type { LocaleRegistry } from "./locale-parity";

// 플랫폼 고유명사 보존 검사의 단일 출처. 판정: 어떤 키의 기준 로케일 값들이 **모두** 명사 N을
// 포함하면, 같은 키의 다른 등록 로케일 값도 N을 포함해야 한다. 일부에만 있으면 번역
// 재량(음역 등)으로 보고 제외한다. 키 자체의 누락·빈 값은 locale-parity 소관이라 여긴
// 침묵한다 — 두 검사기가 같은 위반을 두 번 울리지 않게 한다.
// 기준 로케일은 인자로 받는다(findParityViolations와 같은 규약) — "어떤 로케일이 신뢰할
// 기준인가"는 호출부의 판단이고, 여기 박아두면 소비처마다 다른 기준을 못 준다.
export function findProperNounViolations(
  registry: LocaleRegistry,
  nouns: readonly string[],
  baseLocales: readonly string[],
): string[] {
  if (!baseLocales.length) return ["기준 로케일이 지정되지 않았다"];
  const missing = baseLocales.filter((locale) => !registry[locale]);
  if (missing.length) return missing.map((locale) => `${locale}: 기준 로케일 사전이 없다`);

  const [primary, ...rest] = baseLocales;
  const violations: string[] = [];

  for (const [key, primaryValue] of Object.entries(registry[primary])) {
    const baseValues = [primaryValue, ...rest.map((locale) => registry[locale][key])];
    if (baseValues.some((value) => value == null)) continue;
    for (const noun of nouns) {
      if (!baseValues.every((value) => value.includes(noun))) continue;
      for (const [locale, dict] of Object.entries(registry)) {
        if (baseLocales.includes(locale)) continue;
        const value = dict[key];
        if (value == null) continue;
        if (!value.includes(noun)) violations.push(`${locale} ${key}: '${noun}' 소실`);
      }
    }
  }

  return violations.sort();
}
