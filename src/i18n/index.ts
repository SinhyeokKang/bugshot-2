import ko, { type TranslationKey } from "./ko";
import en from "./en";
import { BASE_LOCALE, BCP47, type LocaleMode } from "./locales";
import { useSettingsUiStore } from "@/store/settings-ui-store";

// 폴백 금지 테이블 — 사전 없는 로케일이 undefined로 조회되면 t()가 죽는다.
// 로케일 추가 시 컴파일러가 여기를 채우게 하려고 Record를 유지한다(Partial 금지).
export const locales: Record<LocaleMode, Record<TranslationKey, string>> = { ko, en };

let currentLocale: LocaleMode = BASE_LOCALE;

export function setLocale(locale: LocaleMode) {
  currentLocale = locale;
}

export function getLocale(): LocaleMode {
  return currentLocale;
}

export function dateBcp47(): string {
  return BCP47[currentLocale];
}

// 이슈 본문 언어용 전역 스왑. 동기 전용이다 — fn 안에서 await하면 복원 시점과 실행 시점이
// 어긋나 감싼 구간 밖까지 로케일이 새므로, Promise 반환을 거부해 무음 누출 대신 즉시 실패시킨다.
// 한계: 반환된 Promise만 잡는다(void asyncFn()·setTimeout·queueMicrotask는 통과).
// locale 인자는 정규화하지 않는다 — 게이트는 store(normalizeBodyLocale)와 생산지
// (resolveBodyLocale)에 있고, 여기서 방어하면 무음 폴백이 생겨 배선 오류가 숨는다.
export function withLocale<T>(locale: LocaleMode, fn: () => T): T {
  const previous = currentLocale;
  currentLocale = locale;
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error("withLocale: fn must be synchronous (returned a Promise)");
    }
    return result;
  } finally {
    currentLocale = previous;
  }
}

function interpolate(
  text: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return text;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

// 타입상 도달 불가(TranslationKey는 닫힌 union). 여기 오면 캐스트가 뚫렸다는 뜻이라 개발 중엔
// 콘솔로 알리고, 프로덕션에선 undefined 렌더/TypeError 대신 키를 노출한다 — 복제 사전
// (log-viewer/i18n.ts)의 `if (!text) return key`와 실패 모드를 맞춘다.
function lookup(locale: LocaleMode, key: TranslationKey): string {
  const text = locales[locale][key];
  if (text === undefined) {
    if (import.meta.env.DEV) console.error(`[i18n] missing key: ${key}`);
    return key;
  }
  return text;
}

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  return interpolate(lookup(currentLocale, key), params);
}

export type TranslationFn = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

export function useT(): TranslationFn {
  const locale = useSettingsUiStore((s) => s.locale);
  if (locale !== currentLocale) currentLocale = locale;
  // t()와 같은 lookup을 탄다 — 두 경로가 갈리면 훅 경유 호출만 폴백이 없다.
  return (key, params) => interpolate(lookup(locale, key), params);
}
