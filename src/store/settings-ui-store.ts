import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import type { TranslationKey } from "@/i18n/ko";
import type { RecordingSource } from "./editor-store";
import { obfuscateApiKey, deobfuscateApiKey } from "@/lib/key-obfuscation";
import { chromeLocalStorage } from "./chrome-storage";

export type ThemeMode = "light" | "dark" | "system";
export type LocaleMode = "ko" | "en";
export type StyleEditorView = "form" | "code";

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
  replayEnabled: boolean;
  attachmentsEnabled: boolean;
  autoReproPrefill: boolean;
  recordingMode: RecordingSource;
  styleEditorView: StyleEditorView;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: LocaleMode) => void;
  setIssueEnabled: (id: IssueSectionId, enabled: boolean) => void;
  resetIssueSections: () => void;
  setLlm: (config: LlmConfig | null) => void;
  setReplayEnabled: (enabled: boolean) => void;
  setAttachmentsEnabled: (enabled: boolean) => void;
  setAutoReproPrefill: (enabled: boolean) => void;
  setRecordingMode: (mode: RecordingSource) => void;
  setStyleEditorView: (view: StyleEditorView) => void;
}

export function migrateSettingsUi(
  persisted: unknown,
  version: number,
): SettingsUiState {
  const state = (persisted ?? {}) as Partial<SettingsUiState>;
  if (version < 2 || !state.issueSections) {
    state.issueSections = DEFAULT_ISSUE_SECTIONS;
  }
  if (version < 3) {
    state.llm = state.llm ?? null;
  }
  if (version < 5 && state.llm && !state.llm.apiKey) {
    state.llm = null;
  }
  state.recordingMode = state.recordingMode ?? "tab";
  state.styleEditorView = state.styleEditorView ?? "form";
  state.autoReproPrefill = state.autoReproPrefill ?? true;
  return state as SettingsUiState;
}

const apiKeyObfuscatingStorage: StateStorage = {
  async getItem(name) {
    const raw = await chromeLocalStorage.getItem(name);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.state?.llm?.apiKey) {
        parsed.state.llm.apiKey = deobfuscateApiKey(parsed.state.llm.apiKey);
      }
      return JSON.stringify(parsed);
    } catch {
      return raw;
    }
  },
  async setItem(name, value) {
    try {
      const parsed = JSON.parse(value);
      if (parsed.state?.llm?.apiKey) {
        parsed.state.llm.apiKey = obfuscateApiKey(parsed.state.llm.apiKey);
      }
      return chromeLocalStorage.setItem(name, JSON.stringify(parsed));
    } catch {
      return chromeLocalStorage.setItem(name, value);
    }
  },
  async removeItem(name) {
    return chromeLocalStorage.removeItem(name);
  },
};

export const useSettingsUiStore = create<SettingsUiState>()(
  persist(
    (set) => ({
      theme: "light",
      locale: detectLocale(),
      issueSections: DEFAULT_ISSUE_SECTIONS,
      llm: null,
      replayEnabled: false,
      attachmentsEnabled: false,
      autoReproPrefill: true,
      recordingMode: "tab",
      styleEditorView: "form",
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setIssueEnabled: (id, enabled) =>
        set((s) => ({
          issueSections: s.issueSections.map((sec) =>
            sec.id === id ? { ...sec, enabled } : sec,
          ),
        })),
      resetIssueSections: () => set({ issueSections: DEFAULT_ISSUE_SECTIONS }),
      setLlm: (config) => set({ llm: config }),
      setReplayEnabled: (enabled) => set({ replayEnabled: enabled }),
      setAttachmentsEnabled: (enabled) => set({ attachmentsEnabled: enabled }),
      setAutoReproPrefill: (enabled) => set({ autoReproPrefill: enabled }),
      setRecordingMode: (recordingMode) => set({ recordingMode }),
      setStyleEditorView: (styleEditorView) => set({ styleEditorView }),
    }),
    {
      // 기존 사용자 데이터 호환을 위해 리네이밍 전 키 유지
      name: "bugshot-app-settings",
      // v3: llm 필드 추가, v4: apiKey를 session→local 이전(apiKeyObfuscatingStorage가 흡수, migrate 분기 없음), v5: apiKey 없는 stale 설정 제거, v6: recordingMode 추가, v7: styleEditorView 추가, v8: autoReproPrefill 추가
      version: 8,
      storage: createJSONStorage(() => apiKeyObfuscatingStorage),
      migrate: migrateSettingsUi,
    },
  ),
);
