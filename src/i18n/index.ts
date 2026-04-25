import ko, { type TranslationKey } from "./ko";
import en from "./en";
import type { LocaleMode } from "@/store/app-settings-store";
import { useAppSettingsStore } from "@/store/app-settings-store";

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

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let text = locales[currentLocale][key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export function useT(): (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string {
  const locale = useAppSettingsStore((s) => s.locale);
  if (locale !== currentLocale) currentLocale = locale;
  return (key, params) => {
    let text = locales[locale][key];
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };
}
