import type { LocaleRegistry } from "./locale-parity";

// 플랫폼 고유명사 보존 검사의 단일 출처. 판정: 어떤 키의 ko와 en 값이 **둘 다** 명사 N을
// 포함하면, 같은 키의 다른 등록 로케일 값도 N을 포함해야 한다. 한쪽에만 있으면 번역
// 재량(음역 등)으로 보고 제외한다. 키 자체의 누락·빈 값은 locale-parity 소관이라 여기선
// 침묵한다 — 두 검사기가 같은 위반을 두 번 울리지 않게 한다.
// 특정 로케일 전용으로 짜지 않는다 — 다음 로케일 추가 시 그대로 재사용한다.
export function findProperNounViolations(
  registry: LocaleRegistry,
  nouns: readonly string[],
): string[] {
  const ko = registry.ko ?? {};
  const en = registry.en ?? {};
  const violations: string[] = [];

  for (const [key, koValue] of Object.entries(ko)) {
    const enValue = en[key];
    if (enValue == null) continue;
    for (const noun of nouns) {
      if (!koValue.includes(noun) || !enValue.includes(noun)) continue;
      for (const [locale, dict] of Object.entries(registry)) {
        if (locale === "ko" || locale === "en") continue;
        const value = dict[key];
        if (value == null) continue;
        if (!value.includes(noun)) violations.push(`${locale} ${key}: '${noun}' 소실`);
      }
    }
  }

  return violations.sort();
}
