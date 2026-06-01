import type { LocaleMode } from "@/store/settings-ui-store";

// GitBook ko/en site (repo guide/{ko,en} → GitHub Sync 단방향). slug 변경 시 함께 갱신.
export const USER_GUIDE_URLS: Record<LocaleMode, string> = {
  ko: "https://bugshot.gitbook.io/ko",
  en: "https://bugshot.gitbook.io/en",
};
