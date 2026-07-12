import type { PromptStyle } from "../ai-provider";

export interface PromptCaps {
  diffs: number;
  designTokens: number;
  styles: number;
  networkErrors: number;
  consoleErrors: number;
  actions: number;
  existingDraftChars: number;
  userPromptChars: number;
}

// Infinity가 아니라 MAX_SAFE_INTEGER — JSON.stringify(Infinity)는 "null"이라
// 캡 값이 직렬화 경로에 새면 조용히 깨진다.
const UNLIMITED = Number.MAX_SAFE_INTEGER;

export const PROMPT_CAPS: Record<PromptStyle, PromptCaps> = {
  compact: {
    diffs: 8,
    designTokens: 5,
    styles: 12,
    networkErrors: 3,
    consoleErrors: 3,
    actions: 5,
    existingDraftChars: 400,
    userPromptChars: 600,
  },
  rich: {
    diffs: 50,
    designTokens: 40,
    styles: 80,
    networkErrors: 5,
    consoleErrors: 5,
    actions: 20,
    existingDraftChars: UNLIMITED,
    userPromptChars: UNLIMITED,
  },
};

// 컨텍스트 0인 compact 본문의 문자 상한. 불변식 테스트 전용 — 런타임 절삭 예산
// (ProviderCapabilities.contextBudgetChars)과는 다른 값이다.
export const COMPACT_SYSTEM_TARGET_CHARS = 2000;
