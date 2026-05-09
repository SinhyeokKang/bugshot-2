import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TranslationKey } from "@/i18n/ko";
import { chromeLocalStorage } from "./chrome-storage";

export type ThemeMode = "light" | "dark" | "system";
export type LocaleMode = "ko" | "en";

export type IssueSectionId =
  | "description"
  | "stepsToReproduce"
  | "expectedResult"
  | "notes";

export type IssueSectionRenderAs = "paragraph" | "orderedList";

export interface IssueSection {
  id: IssueSectionId;
  enabled: boolean;
  labelOverride?: string;
  placeholderOverride?: string;
  renderAs: IssueSectionRenderAs;
  builtIn: true;
}

export const DEFAULT_ISSUE_SECTIONS: IssueSection[] = [
  { id: "description", enabled: true, renderAs: "paragraph", builtIn: true },
  { id: "stepsToReproduce", enabled: true, renderAs: "orderedList", builtIn: true },
  { id: "expectedResult", enabled: true, renderAs: "paragraph", builtIn: true },
  { id: "notes", enabled: false, renderAs: "paragraph", builtIn: true },
];

// 자동 메타(media/styleChanges) 블록보다 뒤에 와야 하는 섹션 id.
// 마크다운/ADF/UI 출력 시 enabled 섹션 iterate 중 이 id를 만나면 메타 블록을 먼저 emit.
export const POST_MEDIA_SECTION_IDS = new Set<IssueSectionId>([
  "expectedResult",
  "notes",
]);

export function sectionLabelKey(id: IssueSectionId): TranslationKey {
  return `section.${id}` as TranslationKey;
}
export function sectionMdLabelKey(id: IssueSectionId): TranslationKey {
  return `md.section.${id}` as TranslationKey;
}
export function sectionPlaceholderKey(id: IssueSectionId): TranslationKey {
  return `draft.${id}Placeholder` as TranslationKey;
}
export function sectionHelpKey(id: IssueSectionId): TranslationKey {
  return `section.${id}.help` as TranslationKey;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

const LLM_API_KEY = "bugshot-llm-api-key";

function saveLlmApiKey(apiKey: string | null): void {
  try {
    if (apiKey) chrome.storage.session.set({ [LLM_API_KEY]: apiKey });
    else chrome.storage.session.remove(LLM_API_KEY);
  } catch { /* test env */ }
}

function loadLlmApiKey(): Promise<string> {
  return chrome.storage.session.get(LLM_API_KEY).then((r) => r[LLM_API_KEY] ?? "");
}

function detectLocale(): LocaleMode {
  const lang =
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language.toLowerCase()
      : "en";
  if (lang.startsWith("ko")) return "ko";
  return "en";
}

interface SettingsUiState {
  theme: ThemeMode;
  locale: LocaleMode;
  issueSections: IssueSection[];
  llm: LlmConfig | null;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: LocaleMode) => void;
  setIssueEnabled: (id: IssueSectionId, enabled: boolean) => void;
  resetIssueSections: () => void;
  setLlm: (config: LlmConfig | null) => void;
}

export const useSettingsUiStore = create<SettingsUiState>()(
  persist(
    (set) => ({
      theme: "light",
      locale: detectLocale(),
      issueSections: DEFAULT_ISSUE_SECTIONS,
      llm: null,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setIssueEnabled: (id, enabled) =>
        set((s) => ({
          issueSections: s.issueSections.map((sec) =>
            sec.id === id ? { ...sec, enabled } : sec,
          ),
        })),
      resetIssueSections: () => set({ issueSections: DEFAULT_ISSUE_SECTIONS }),
      setLlm: (config) => {
        saveLlmApiKey(config?.apiKey ?? null);
        set({ llm: config });
      },
    }),
    {
      // 기존 사용자 데이터 호환을 위해 리네이밍 전 키 유지
      name: "bugshot-app-settings",
      version: 4,
      storage: createJSONStorage(() => chromeLocalStorage),
      partialize: (state) => ({
        theme: state.theme,
        locale: state.locale,
        issueSections: state.issueSections,
        llm: state.llm ? { baseUrl: state.llm.baseUrl, modelId: state.llm.modelId, apiKey: "" } : null,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state?.llm) return;
        try {
          loadLlmApiKey().then((apiKey) => {
            if (!apiKey) return;
            const current = useSettingsUiStore.getState().llm;
            if (current) useSettingsUiStore.setState({ llm: { ...current, apiKey } });
          });
        } catch { /* test env */ }
      },
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<SettingsUiState>;
        if (version < 2 || !state.issueSections) {
          state.issueSections = DEFAULT_ISSUE_SECTIONS;
        }
        if (version < 3) {
          state.llm = state.llm ?? null;
        }
        if (version < 4 && state.llm) {
          // v3→v4: apiKey가 local에 있었으면 session으로 이관 후 local에서 제거
          saveLlmApiKey(state.llm.apiKey || null);
          state.llm = { ...state.llm, apiKey: "" };
        }
        return state as SettingsUiState;
      },
    },
  ),
);
