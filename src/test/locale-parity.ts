// 로케일 사전 대칭 검사의 단일 출처. 메인 i18n과 log-viewer 복제 사전 양쪽이 같은 규칙으로
// 검사돼야 하는데, 두 테스트가 각자 ko/en을 하드 import해 검사 로직을 복제하고 있었다 —
// 로케일이 늘어도 검사가 따라오지 않는 구조였다. 레지스트리를 인자로 받는 순수 함수로 빼서
// 두 곳이 공유하고, 이 함수 자체는 __tests__/locale-parity.test.ts가 깨진 fixture로 검증한다.

export type LocaleDict = Record<string, string>;
export type LocaleRegistry = Record<string, LocaleDict>;

export function placeholderTokens(text: string): string[] {
  return [...text.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)]
    .map((m) => m[1])
    .sort();
}

// 기준 로케일 사전을 진실로 삼아 나머지 전부를 대조한다. 위반은 사람이 읽는 문자열로
// 모아 반환 — expect(violations).toEqual([])가 실패하면 무엇이 틀렸는지 그대로 보인다.
export function findParityViolations(
  registry: LocaleRegistry,
  baseLocale: string,
): string[] {
  const base = registry[baseLocale];
  if (!base) return [`${baseLocale}: 기준 로케일 사전이 없다`];

  const violations: string[] = [];
  const baseKeys = Object.keys(base);

  for (const [locale, dict] of Object.entries(registry)) {
    for (const [key, value] of Object.entries(dict)) {
      if (!value || !String(value).trim()) {
        violations.push(`${locale} ${key}: 빈 값`);
      }
    }

    if (locale === baseLocale) continue;

    const keys = new Set(Object.keys(dict));
    for (const key of baseKeys) {
      if (!keys.has(key)) violations.push(`${locale} ${key}: 누락`);
    }
    for (const key of keys) {
      if (!(key in base)) violations.push(`${locale} ${key}: ${baseLocale}에 없는 잉여 키`);
    }
    for (const key of baseKeys) {
      if (!keys.has(key)) continue;
      const expected = placeholderTokens(base[key]);
      const actual = placeholderTokens(dict[key]);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        violations.push(
          `${locale} ${key}: 토큰 [${actual}] ≠ ${baseLocale} [${expected}]`,
        );
      }
    }
  }

  return violations.sort();
}

// LOCALES에 등록만 하고 실제 사전·메타 테이블을 안 만든 로케일. `locales`·`BCP47`처럼
// en 폴백이 금지된 테이블에서 이게 유일한 강제 수단이다(Partial로 바꾸면 타입이 못 잡는다).
export function findUncovered(
  locales: readonly string[],
  map: Record<string, unknown>,
): string[] {
  return locales.filter((locale) => map[locale] == null);
}

// 반대 방향 — 사전은 있는데 LOCALES에 없어 아무도 도달할 수 없는 로케일.
export function findExtraneous(
  locales: readonly string[],
  map: Record<string, unknown>,
): string[] {
  const registered = new Set(locales);
  return Object.keys(map).filter((locale) => !registered.has(locale));
}
