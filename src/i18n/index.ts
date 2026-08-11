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

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  return interpolate(locales[currentLocale][key], params);
}

export type TranslationFn = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

export function useT(): TranslationFn {
  const locale = useSettingsUiStore((s) => s.locale);
  if (locale !== currentLocale) currentLocale = locale;
  return (key, params) => interpolate(locales[locale][key], params);
}
