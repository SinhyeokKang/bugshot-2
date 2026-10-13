import { normalizeBodyLocale, normalizeLocale, resolveBodyLocale, type BodyLocale, type LocaleMode } from "@/i18n/locales";

export type LanguageEventProperties = {
  ui_locale: LocaleMode;
  report_locale_setting: BodyLocale;
  report_locale: LocaleMode;
};

export function languageEventProperties(locale: unknown, bodyLocale: unknown): LanguageEventProperties {
  const uiLocale = normalizeLocale(locale);
  const setting = normalizeBodyLocale(bodyLocale);
  return {
    ui_locale: uiLocale,
    report_locale_setting: setting,
    report_locale: resolveBodyLocale(setting, uiLocale),
  };
}
