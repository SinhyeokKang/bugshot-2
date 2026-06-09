import type { LocaleMode } from "@/store/settings-ui-store";

// GitBook ko/en site (repo guide/{ko,en} → GitHub Sync 단방향). slug 변경 시 함께 갱신.
export const USER_GUIDE_URLS: Record<LocaleMode, string> = {
  ko: "https://bugshot.gitbook.io/ko",
  en: "https://bugshot.gitbook.io/en",
};

// Chrome 웹스토어 후기 작성 페이지 (스토어 extension ID). 후기 유도 버튼 공용.
export const STORE_REVIEW_URL =
  "https://chromewebstore.google.com/detail/bugshot/ohakhekagkodklkickemonmifdcbhmig/reviews";
