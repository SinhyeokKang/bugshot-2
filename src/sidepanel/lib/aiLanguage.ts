import type { LocaleMode } from "@/i18n/locales";

// value는 프롬프트 지시문에 그대로 박히는 영어 이름이고, label은 셀렉터에 보이는 자기 언어 표기다.
// auto는 여기 없다 — 라벨이 "자동 (한국어)"처럼 해석 결과에 따라 바뀌어 i18n 몫이다.
export const AI_LANGUAGE_OPTIONS = [
  { value: "English", label: "English" },
  { value: "Korean", label: "한국어" },
  { value: "Japanese", label: "日本語" },
  { value: "Chinese (Simplified)", label: "中文(简体)" },
  { value: "Spanish", label: "Español" },
  { value: "French", label: "Français" },
  { value: "German", label: "Deutsch" },
  { value: "Portuguese (Brazil)", label: "Português (Brasil)" },
  { value: "Russian", label: "Русский" },
] as const satisfies readonly { value: string; label: string }[];

export type AiLanguagePreset = (typeof AI_LANGUAGE_OPTIONS)[number]["value"];
export type AiLanguage = "auto" | AiLanguagePreset;

// 프리셋 값이 프롬프트로 나가므로 임의 문자열을 통과시키지 않는다(오염된 storage 방어).
export function normalizeAiLanguage(value: unknown): AiLanguage {
  if (value === "auto") return "auto";
  return AI_LANGUAGE_OPTIONS.some((o) => o.value === value)
    ? (value as AiLanguagePreset)
    : "auto";
}

// 폴백 금지 테이블 — 로케일을 추가하면 컴파일러가 여기를 채우게 한다. 3항 연산자로 두면
// 새 로케일이 조용히 English로 해석돼 UI만 그 언어이고 AI 초안은 영어로 나온다.
const LOCALE_AI_PRESET: Record<LocaleMode, AiLanguagePreset> = {
  ko: "Korean",
  en: "English",
};

export function localeAiPreset(locale: LocaleMode): AiLanguagePreset {
  return LOCALE_AI_PRESET[locale];
}

// auto는 저장 시점 스냅샷이 아니라 호출 시점 해석이다 — 굳히면 UI 언어를 바꿔도 AI만 옛 언어로 남는다.
export function resolveAiLanguage(
  value: AiLanguage | undefined,
  locale: LocaleMode,
): AiLanguagePreset {
  const normalized = normalizeAiLanguage(value);
  if (normalized !== "auto") return normalized;
  return localeAiPreset(locale);
}

export function aiLanguageLabel(preset: AiLanguagePreset): string {
  return AI_LANGUAGE_OPTIONS.find((o) => o.value === preset)!.label;
}
