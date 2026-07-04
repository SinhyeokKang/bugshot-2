import type { LocaleMode } from "@/store/settings-ui-store";

// 사용자 가이드 (repo guide/{ko,en} → bugshot-web 빌드타임 fetch → bug-shot.com/{locale}/docs). slug 변경 시 함께 갱신.
export const USER_GUIDE_URLS: Record<LocaleMode, string> = {
  ko: "https://bug-shot.com/ko/docs",
  en: "https://bug-shot.com/en/docs",
};

// Chrome 웹스토어 후기 작성 페이지 (스토어 extension ID). 후기 유도 버튼 공용.
export const STORE_REVIEW_URL =
  "https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig/reviews";
