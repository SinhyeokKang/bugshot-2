import { setLocale } from "./index";
import type { LocaleMode } from "@/store/app-settings-store";

function extractLocale(raw: unknown): LocaleMode | undefined {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const locale = (parsed as { state?: { locale?: string } })?.state?.locale;
    if (locale === "ko" || locale === "en") return locale;
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
