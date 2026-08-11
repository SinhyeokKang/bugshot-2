import { localeValue, type LocaleMode, type LocaleTable } from "@/i18n/locales";

// 사용자 가이드 (repo guide/{ko,en} → bugshot-web 빌드타임 fetch → bug-shot.com/{locale}/docs). slug 변경 시 함께 갱신.
// 폴백 허용 — 가이드 번역이 없는 로케일은 en 가이드로 보낸다(UI만 현지화하는 경로).
export const USER_GUIDE_URLS: LocaleTable<string> = {
  ko: "https://bug-shot.com/ko/docs",
  en: "https://bug-shot.com/en/docs",
};

export function userGuideUrl(locale: LocaleMode): string {
  return localeValue(USER_GUIDE_URLS, locale);
}

// Chrome 웹스토어 후기 작성 페이지 (스토어 extension ID). 후기 유도 버튼 공용.
export const STORE_REVIEW_URL =
  "https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig/reviews";
