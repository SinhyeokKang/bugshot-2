import type { LocaleMode } from "@/i18n/locales";

// 폴백 금지 테이블 — 라벨이 없으면 그 로케일이 셀렉터에 아예 안 떠서 사용자가 고를 수 없다.
// 배열로 두면 사전을 다 채워놓고도 무음으로 빠지므로 컴파일이 채우게 한다.
// 값은 자기 언어 표기다(AI_LANGUAGE_OPTIONS의 label과 같은 컨벤션 — 모국어로 읽히게).
export const LOCALE_LABELS: Record<LocaleMode, string> = {
  ko: "한국어",
  en: "English",
  fr: "Français",
};
