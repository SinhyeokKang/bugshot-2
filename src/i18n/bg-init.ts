import { APP_SETTINGS_PERSIST_KEY } from "@/lib/session-keys";
import { setLocale } from "./index";
import { normalizeLocale, type LocaleMode } from "./locales";

function extractLocale(raw: unknown): LocaleMode | undefined {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const locale = (parsed as { state?: { locale?: string } })?.state?.locale;
    // 값이 아예 없으면 undefined를 유지한다 — 없는 걸 기본 로케일로 덮어쓰면
    // 사이드패널이 detectLocale로 정한 로케일을 background가 뭉갠다.
    if (locale === undefined) return undefined;
    return normalizeLocale(locale);
  } catch {}
  return undefined;
}

export function initBgLocale() {
  chrome.storage.local.get(APP_SETTINGS_PERSIST_KEY, (result) => {
    const locale = extractLocale(result[APP_SETTINGS_PERSIST_KEY]);
    if (locale) setLocale(locale);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[APP_SETTINGS_PERSIST_KEY]) return;
    const locale = extractLocale(changes[APP_SETTINGS_PERSIST_KEY].newValue);
    if (locale) setLocale(locale);
  });
}
