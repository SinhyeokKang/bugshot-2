import ko, { type TranslationKey } from "./ko";
import en from "./en";
import type { LocaleMode } from "@/store/settings-ui-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";

const locales: Record<LocaleMode, Record<TranslationKey, string>> = { ko, en };

let currentLocale: LocaleMode = "ko";

export function setLocale(locale: LocaleMode) {
  currentLocale = locale;
}

export function getLocale(): LocaleMode {
  return currentLocale;
}

const BCP47: Record<LocaleMode, string> = { ko: "ko-KR", en: "en-US" };

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
