// 로케일 레지스트리 단일 출처. **의존성 0을 유지해야 한다** — log-viewer는 별도 번들이고
// vite alias가 `@/i18n`을 복제 사전으로 돌리므로 이 파일을 상대경로로 직접 끌어간다. 여기에
// store(zustand + chrome.storage)가 딸려오면 그 번들과 service worker 양쪽이 깨진다.
// 불변식은 __tests__/locale-registry.test.ts가 소스 스캔으로 강제한다.

export const LOCALES = ["ko", "en"] as const;

export type LocaleMode = (typeof LOCALES)[number];

// 번역 키 집합을 정의하는 사전 — 나머지 로케일은 여기에 맞춰 대조된다.
export const BASE_LOCALE = "ko" as const satisfies LocaleMode;

// 미지 값이 떨어질 곳. 모르는 사용자에게 한국어를 주지 않는다.
export const DEFAULT_LOCALE = "en" as const satisfies LocaleMode;

// 폴백 금지 테이블 — 로케일을 추가하면 컴파일러가 여기를 채우라고 해야 한다.
export const BCP47: Record<LocaleMode, string> = {
  ko: "ko-KR",
  en: "en-US",
};

function isLocale(value: unknown): value is LocaleMode {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// 저장값 게이트. normalizeAiLanguage와 같이 대소문자 관용을 두지 않는다 — 어떤 표기가
// 정본인지 흐려진다. 실제로 막는 건 다운그레이드다: 새 로케일을 쓰던 사용자가 구버전으로
// 롤백되면 persist에 그 코드가 남고, 통과시키면 사전 조회가 undefined라 t()가 죽는다.
export function normalizeLocale(value: unknown): LocaleMode {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

// 가장 구체적인(=긴) 후보가 이긴다. 선언 순서로 고르면 `pt` 다음에 `pt-BR`을 추가했을 때
// 짧은 쪽이 먼저 먹어 긴 쪽이 영구 도달 불가가 된다 — 로케일 추가를 안전하게 만드는 게
// 이 모듈의 목적이라 그 함정을 규칙으로 막는다.
export function matchLocaleTag<T extends string>(
  tag: string,
  candidates: readonly T[],
): T | undefined {
  let best: T | undefined;
  for (const candidate of candidates) {
    if (!tag.startsWith(candidate)) continue;
    if (best === undefined || candidate.length > best.length) best = candidate;
  }
  return best;
}

// 브라우저가 주는 언어 태그 해석 — 이쪽은 관용적이다(지역 서브태그·대소문자 흡수).
// 전역을 직접 읽지 않고 인자로 받아 순수 함수로 남긴다(호출부가 존재 여부를 판단).
export function detectLocale(languageTag: string | undefined): LocaleMode {
  const tag = languageTag?.toLowerCase() ?? "";
  return matchLocaleTag(tag, LOCALES) ?? DEFAULT_LOCALE;
}

// 폴백 **허용** 테이블의 형태. 기본 로케일 항목은 필수고 나머지는 선택이다 —
// 프롬프트 섹션 설명처럼 "영어 스캐폴딩 + Write in X"가 설계인 테이블에만 쓴다.
// locales·BCP47·LOCALE_AI_PRESET 같은 폴백 금지 테이블엔 쓰지 않는다(무음 영어 누출).
export type LocaleTable<T> = Partial<Record<LocaleMode, T>> &
  Record<typeof DEFAULT_LOCALE, T>;

export function localeValue<T>(table: LocaleTable<T>, locale: LocaleMode): T {
  return table[locale] ?? table[DEFAULT_LOCALE];
}
