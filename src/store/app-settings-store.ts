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

function detectLocale(): LocaleMode {
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith("ko")) return "ko";
  return "en";
}

interface AppSettingsState {
  theme: ThemeMode;
  locale: LocaleMode;
  issueSections: IssueSection[];
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: LocaleMode) => void;
  setIssueEnabled: (id: IssueSectionId, enabled: boolean) => void;
  resetIssueSections: () => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      theme: "light",
      locale: detectLocale(),
      issueSections: DEFAULT_ISSUE_SECTIONS,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setIssueEnabled: (id, enabled) =>
        set((s) => ({
          issueSections: s.issueSections.map((sec) =>
            sec.id === id ? { ...sec, enabled } : sec,
          ),
        })),
      resetIssueSections: () => set({ issueSections: DEFAULT_ISSUE_SECTIONS }),
    }),
    {
      name: "bugshot-app-settings",
      version: 2,
      storage: createJSONStorage(() => chromeLocalStorage),
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<AppSettingsState>;
        if (version < 2 || !state.issueSections) {
          state.issueSections = DEFAULT_ISSUE_SECTIONS;
        }
        return state as AppSettingsState;
      },
    },
  ),
);
