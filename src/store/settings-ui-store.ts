import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import type { TranslationKey } from "@/i18n/ko";
import type { RecordingSource } from "./editor-store";
import { obfuscateApiKey, deobfuscateApiKey } from "@/lib/key-obfuscation";
import { APP_SETTINGS_PERSIST_KEY } from "@/lib/session-keys";
import { normalizeAiLanguage, type AiLanguage } from "@/sidepanel/lib/aiLanguage";
import { chromeLocalStorage } from "./chrome-storage";
import {
  detectLocale,
  normalizeBodyLocale,
  normalizeLocale,
  type BodyLocale,
  type LocaleMode,
} from "@/i18n/locales";

export type ThemeMode = "light" | "dark" | "system";
// 정의는 @/i18n/locales가 갖는다(background·log-viewer 번들 공용). 여기서 re-export하는 건
// 기존 import 경로를 쓰는 소비처를 안 깨뜨리려는 것 — 방향은 store → i18n 단방향이다.
export type { LocaleMode };
export type StyleEditorView = "form" | "code";

export type IssueSectionId =
  | "description"
  | "stepsToReproduce"
  | "media"
  | "expectedResult"
  | "notes";

// 텍스트 본문을 갖는 섹션 — media는 위치 슬롯일 뿐이라 AI 프롬프트·Report 탭처럼
// 본문 텍스트만 소비하는 경로에서는 이 타입을 쓴다.
export type TextSectionId = Exclude<IssueSectionId, "media">;

// "meta" = 미디어/스타일 diff + 로그 요약 클러스터(media 엔트리 전용). 텍스트 본문이 없다.
export type IssueSectionRenderAs = "paragraph" | "orderedList" | "meta";

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
  { id: "media", enabled: true, renderAs: "meta", builtIn: true },
  { id: "expectedResult", enabled: true, renderAs: "paragraph", builtIn: true },
  { id: "notes", enabled: false, renderAs: "paragraph", builtIn: true },
];

const MEDIA_SECTION: IssueSection = {
  id: "media",
  enabled: true,
  renderAs: "meta",
  builtIn: true,
};

// v8까지 미디어 위치를 정하던 앵커(첫 enabled post-media 섹션 직전). 이제는 backfill
// 지점 계산에만 쓴다 — 마이그레이션 직후 본문 레이아웃이 그대로여야 하므로.
const LEGACY_POST_MEDIA_SECTION_IDS = new Set<IssueSectionId>([
  "expectedResult",
  "notes",
]);

// 미디어 엔트리를 "정확히 1개"로 정규화한다. 0개면 본문에서 미디어·로그가 통째로
// 사라지고, 2개면 중복 렌더된다. 멱등 — 마이그레이션·rehydrate 공용.
export function normalizeSections(sections: IssueSection[]): IssueSection[] {
  const found = sections.filter((s) => s.id === "media");
  const entry: IssueSection = found[0]
    ? { ...found[0], enabled: true, renderAs: "meta" }
    : MEDIA_SECTION;

  if (found.length === 1) {
    return sections.map((s) => (s.id === "media" ? entry : s));
  }

  const rest = sections.filter((s) => s.id !== "media");
  const anchor = rest.findIndex(
    (s) => s.enabled && LEGACY_POST_MEDIA_SECTION_IDS.has(s.id),
  );
  return anchor === -1
    ? [...rest, entry]
    : [...rest.slice(0, anchor), entry, ...rest.slice(anchor)];
}

export function sectionLabelKey(id: IssueSectionId): TranslationKey {
  return `section.${id}`;
}
export function sectionMdLabelKey(id: IssueSectionId): TranslationKey {
  return `md.section.${id}`;
}
export function sectionPlaceholderKey(id: TextSectionId): TranslationKey {
  return `draft.${id}Placeholder`;
}
export function sectionHelpKey(id: TextSectionId): TranslationKey {
  return `section.${id}.help`;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

function browserLanguage(): string | undefined {
  return typeof navigator !== "undefined" ? navigator.language : undefined;
}

interface SettingsUiState {
  theme: ThemeMode;
  locale: LocaleMode;
  // UI 언어와 독립된 축 — "auto"면 locale을 따라간다(해석은 resolveAiLanguage).
  aiLanguage: AiLanguage;
  // 제출·복사되는 이슈 본문의 스캐폴딩 언어. 화면 언어·AI 작성 언어와 독립된 세 번째 축이고
  // "auto"면 locale을 따라간다(해석은 resolveBodyLocale).
  bodyLocale: BodyLocale;
  issueSections: IssueSection[];
  llm: LlmConfig | null;
  replayEnabled: boolean;
  attachmentsEnabled: boolean;
  autoReproPrefill: boolean;
  recordingMode: RecordingSource;
  styleEditorView: StyleEditorView;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: LocaleMode) => void;
  setAiLanguage: (aiLanguage: AiLanguage) => void;
  setBodyLocale: (bodyLocale: BodyLocale) => void;
  setIssueEnabled: (id: IssueSectionId, enabled: boolean) => void;
  reorderIssueSections: (from: number, to: number) => void;
  resetIssueSectionOrder: () => void;
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
  // ??가 아니라 정규화다 — 이 값은 프롬프트 지시문으로 나가므로 오염된 문자열을 통과시키지 않는다.
  state.aiLanguage = normalizeAiLanguage(state.aiLanguage);
  // v11: bodyLocale 추가. mergePersistedSettings가 rehydrate마다 재정규화하므로 이 줄은
  // 기능적으로 중복이다 — aiLanguage 선례와의 일관성 + 필드 도입 시점 기록용으로 둔다.
  state.bodyLocale = normalizeBodyLocale(state.bodyLocale);
  // 로케일은 v1부터 있던 필드라 version 분기가 없다. 정규화가 막는 건 다운그레이드다 —
  // 새 로케일을 쓰던 persist가 구버전으로 롤백되면 사전 조회가 undefined가 된다.
  state.locale = normalizeLocale(state.locale);
  // v9: 순서 배열에 미디어 엔트리 편입(레거시 앵커 위치로 backfill → 레이아웃 불변)
  state.issueSections = normalizeSections(state.issueSections ?? DEFAULT_ISSUE_SECTIONS);
  return state as SettingsUiState;
}

// migrate는 버전이 다를 때만 돈다 — 동일 버전에서 외부 오염된 값도 교정하도록 rehydrate마다
// 재정규화한다. persist 옵션 안 익명 함수로 두면 테스트가 닿지 못해 이 방어가 무검증으로 남는다.
export function mergePersistedSettings(
  persisted: unknown,
  current: SettingsUiState,
): SettingsUiState {
  const p = (persisted ?? {}) as Partial<SettingsUiState>;
  return {
    ...current,
    ...p,
    // 저장된 값이 없으면 detectLocale이 정한 현재 값을 유지한다(없는 걸 덮어쓰지 않는다).
    locale: p.locale === undefined ? current.locale : normalizeLocale(p.locale),
    issueSections: normalizeSections(p.issueSections ?? current.issueSections),
    aiLanguage: normalizeAiLanguage(p.aiLanguage),
    bodyLocale: normalizeBodyLocale(p.bodyLocale),
  };
}

export const apiKeyObfuscatingStorage: StateStorage = {
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
      locale: detectLocale(browserLanguage()),
      aiLanguage: "auto",
      bodyLocale: "auto",
      issueSections: DEFAULT_ISSUE_SECTIONS,
      llm: null,
      replayEnabled: false,
      attachmentsEnabled: false,
      autoReproPrefill: true,
      recordingMode: "tab",
      styleEditorView: "form",
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setAiLanguage: (aiLanguage) => set({ aiLanguage }),
      setBodyLocale: (bodyLocale) => set({ bodyLocale }),
      setIssueEnabled: (id, enabled) => {
        // 미디어 카드엔 사용 여부 스위치가 없다(위치만 관장) — 오염 유입 차단.
        if (id === "media") return;
        set((s) => ({
          issueSections: s.issueSections.map((sec) =>
            sec.id === id ? { ...sec, enabled } : sec,
          ),
        }));
      },
      // arrayMove는 @dnd-kit이 아니라 여기 인라인 — 이 스토어는 background service worker
      // 번들에 포함되므로 UI DnD 라이브러리를 그래프에 끌어들이면 안 된다.
      reorderIssueSections: (from, to) =>
        set((s) => {
          const list = s.issueSections;
          const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < list.length;
          if (from === to || !valid(from) || !valid(to)) return {};
          const next = [...list];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { issueSections: next };
        }),
      // 순서만 기본값으로. 사용 여부(enabled)는 사용자 것이라 건드리지 않는다.
      resetIssueSectionOrder: () =>
        set((s) => {
          const order = DEFAULT_ISSUE_SECTIONS.map((d) => d.id);
          const rank = (id: IssueSectionId) => {
            const i = order.indexOf(id);
            return i === -1 ? order.length : i; // 기본 배열에 없는 항목은 말미 보존
          };
          return {
            issueSections: [...s.issueSections].sort((a, b) => rank(a.id) - rank(b.id)),
          };
        }),
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
      name: APP_SETTINGS_PERSIST_KEY,
      // v3: llm 필드 추가, v4: apiKey를 session→local 이전(apiKeyObfuscatingStorage가 흡수, migrate 분기 없음), v5: apiKey 없는 stale 설정 제거, v6: recordingMode 추가, v7: styleEditorView 추가, v8: autoReproPrefill 추가, v9: issueSections에 media 엔트리 편입, v10: aiLanguage 추가, v11: bodyLocale 추가
      version: 11,
      storage: createJSONStorage(() => apiKeyObfuscatingStorage),
      migrate: migrateSettingsUi,
      merge: mergePersistedSettings,
    },
  ),
);
