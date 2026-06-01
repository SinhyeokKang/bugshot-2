import type { LocaleMode } from "@/store/settings-ui-store";

// GitBook ko/en site 퍼블리시 후 실제 URL로 확정 필요 (placeholder 상태로 main 머지 금지).
export const USER_GUIDE_URLS: Record<LocaleMode, string> = {
  ko: "https://bugshot.gitbook.io/bugshot",
  en: "https://bugshot.gitbook.io/bugshot-en",
};
