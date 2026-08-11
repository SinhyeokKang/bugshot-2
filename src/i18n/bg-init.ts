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
  chrome.storage.local.get("bugshot-app-settings", (result) => {
    const locale = extractLocale(result["bugshot-app-settings"]);
    if (locale) setLocale(locale);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes["bugshot-app-settings"]) return;
    const locale = extractLocale(changes["bugshot-app-settings"].newValue);
    if (locale) setLocale(locale);
  });
}
