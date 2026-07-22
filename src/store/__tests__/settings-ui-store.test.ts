import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiKeyObfuscatingStorage,
  DEFAULT_ISSUE_SECTIONS,
  POST_MEDIA_SECTION_IDS,
  migrateSettingsUi,
  sectionHelpKey,
  sectionLabelKey,
  sectionMdLabelKey,
  sectionPlaceholderKey,
  useSettingsUiStore,
  type IssueSectionId,
  type LlmConfig,
} from "../settings-ui-store";

describe("settings-ui-store", () => {
  describe("DEFAULT_ISSUE_SECTIONS", () => {
    it("4종 빌트인 섹션이 올바른 순서로 정의됨", () => {
      const ids = DEFAULT_ISSUE_SECTIONS.map((s) => s.id);
      expect(ids).toEqual(["description", "stepsToReproduce", "expectedResult", "notes"]);
    });

    it("description/stepsToReproduce/expectedResult는 enabled, notes는 disabled", () => {
      const map = Object.fromEntries(DEFAULT_ISSUE_SECTIONS.map((s) => [s.id, s.enabled]));
      expect(map).toEqual({
        description: true,
        stepsToReproduce: true,
        expectedResult: true,
        notes: false,
      });
    });

    it("stepsToReproduce만 orderedList, 나머지는 paragraph", () => {
      const map = Object.fromEntries(DEFAULT_ISSUE_SECTIONS.map((s) => [s.id, s.renderAs]));
      expect(map).toEqual({
        description: "paragraph",
        stepsToReproduce: "orderedList",
        expectedResult: "paragraph",
        notes: "paragraph",
      });
    });
  });

  describe("POST_MEDIA_SECTION_IDS", () => {
    it("expectedResult와 notes만 포함", () => {
      expect(POST_MEDIA_SECTION_IDS.has("expectedResult")).toBe(true);
      expect(POST_MEDIA_SECTION_IDS.has("notes")).toBe(true);
      expect(POST_MEDIA_SECTION_IDS.has("description")).toBe(false);
      expect(POST_MEDIA_SECTION_IDS.has("stepsToReproduce")).toBe(false);
    });
  });

  describe("section key 헬퍼", () => {
    const ids: IssueSectionId[] = ["description", "stepsToReproduce", "expectedResult", "notes"];

    it("sectionLabelKey는 section.{id} 형식", () => {
      ids.forEach((id) => expect(sectionLabelKey(id)).toBe(`section.${id}`));
    });

    it("sectionMdLabelKey는 md.section.{id} 형식", () => {
      ids.forEach((id) => expect(sectionMdLabelKey(id)).toBe(`md.section.${id}`));
    });

    it("sectionPlaceholderKey는 draft.{id}Placeholder 형식", () => {
      ids.forEach((id) => expect(sectionPlaceholderKey(id)).toBe(`draft.${id}Placeholder`));
    });

    it("sectionHelpKey는 section.{id}.help 형식", () => {
      ids.forEach((id) => expect(sectionHelpKey(id)).toBe(`section.${id}.help`));
    });
  });

  describe("store actions", () => {
    it("setTheme으로 테마 변경", () => {
      useSettingsUiStore.getState().setTheme("dark");
      expect(useSettingsUiStore.getState().theme).toBe("dark");
      useSettingsUiStore.getState().setTheme("light");
      expect(useSettingsUiStore.getState().theme).toBe("light");
    });

    it("setLocale로 로케일 변경", () => {
      useSettingsUiStore.getState().setLocale("en");
      expect(useSettingsUiStore.getState().locale).toBe("en");
      useSettingsUiStore.getState().setLocale("ko");
      expect(useSettingsUiStore.getState().locale).toBe("ko");
    });

    it("setIssueEnabled로 개별 섹션 토글", () => {
      useSettingsUiStore.getState().resetIssueSections();
      useSettingsUiStore.getState().setIssueEnabled("notes", true);
      const notes = useSettingsUiStore.getState().issueSections.find((s) => s.id === "notes");
      expect(notes?.enabled).toBe(true);

      useSettingsUiStore.getState().setIssueEnabled("description", false);
      const desc = useSettingsUiStore.getState().issueSections.find((s) => s.id === "description");
      expect(desc?.enabled).toBe(false);
    });

    it("resetIssueSections로 기본값 복원", () => {
      useSettingsUiStore.getState().setIssueEnabled("notes", true);
      useSettingsUiStore.getState().setIssueEnabled("description", false);
      useSettingsUiStore.getState().resetIssueSections();
      expect(useSettingsUiStore.getState().issueSections).toEqual(DEFAULT_ISSUE_SECTIONS);
    });

    it("setLlm으로 LLM 설정 저장", () => {
      const config: LlmConfig = {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test123",
        modelId: "gpt-4o-mini",
      };
      useSettingsUiStore.getState().setLlm(config);
      expect(useSettingsUiStore.getState().llm).toEqual(config);
    });

    it("setLlm(null)로 LLM 설정 초기화", () => {
      useSettingsUiStore.getState().setLlm({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        modelId: "gpt-4o",
      });
      useSettingsUiStore.getState().setLlm(null);
      expect(useSettingsUiStore.getState().llm).toBeNull();
    });

    it("setLlm으로 modelId만 갱신", () => {
      const base: LlmConfig = {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        modelId: "",
      };
      useSettingsUiStore.getState().setLlm(base);
      useSettingsUiStore.getState().setLlm({ ...base, modelId: "gpt-4o-mini" });
      expect(useSettingsUiStore.getState().llm?.modelId).toBe("gpt-4o-mini");
    });

    it("setRecordingMode로 녹화 모드 변경", () => {
      useSettingsUiStore.getState().setRecordingMode("screen");
      expect(useSettingsUiStore.getState().recordingMode).toBe("screen");
      useSettingsUiStore.getState().setRecordingMode("tab");
      expect(useSettingsUiStore.getState().recordingMode).toBe("tab");
    });
  });

  describe("recordingMode 마이그레이션 (v5→v6)", () => {
    it("recordingMode 부재 시 기본값 'tab' 부여", () => {
      const migrated = migrateSettingsUi({}, 5);
      expect(migrated.recordingMode).toBe("tab");
    });

    it("기존 recordingMode는 보존(덮어쓰지 않음)", () => {
      const migrated = migrateSettingsUi({ recordingMode: "screen" }, 5);
      expect(migrated.recordingMode).toBe("screen");
    });
  });

  describe("styleEditorView 마이그레이션 (v6→v7)", () => {
    it("styleEditorView 부재 시 기본값 'form' 부여", () => {
      const migrated = migrateSettingsUi({}, 6);
      expect(migrated.styleEditorView).toBe("form");
    });

    it("기존 styleEditorView는 보존(덮어쓰지 않음)", () => {
      const migrated = migrateSettingsUi({ styleEditorView: "code" }, 6);
      expect(migrated.styleEditorView).toBe("code");
    });
  });

  describe("autoReproPrefill 마이그레이션 (v7→v8)", () => {
    it("autoReproPrefill 부재 시 기본값 true 부여", () => {
      const migrated = migrateSettingsUi({}, 7);
      expect(migrated.autoReproPrefill).toBe(true);
    });

    it("기존 autoReproPrefill=false는 보존(덮어쓰지 않음)", () => {
      const migrated = migrateSettingsUi({ autoReproPrefill: false }, 7);
      expect(migrated.autoReproPrefill).toBe(false);
    });
  });

  describe("초기 마이그레이션 분기 (v1→v5)", () => {
    it("v1에서 올라오면 issueSections 기본값을 주입한다", () => {
      const migrated = migrateSettingsUi({}, 1);
      expect(migrated.issueSections).toEqual(DEFAULT_ISSUE_SECTIONS);
    });

    it("issueSections가 이미 있으면 보존한다", () => {
      const custom = [{ ...DEFAULT_ISSUE_SECTIONS[0], enabled: false }];
      const migrated = migrateSettingsUi({ issueSections: custom }, 2);
      expect(migrated.issueSections).toEqual(custom);
    });

    it("v2에서 올라오면 llm을 null로 초기화한다", () => {
      const migrated = migrateSettingsUi({}, 2);
      expect(migrated.llm).toBeNull();
    });

    it("v4 이하의 apiKey 없는 stale llm 설정은 제거한다", () => {
      const stale = { provider: "openai", modelId: "gpt-4" } as unknown as LlmConfig;
      const migrated = migrateSettingsUi({ llm: stale }, 4);
      expect(migrated.llm).toBeNull();
    });

    it("apiKey가 있는 llm 설정은 v4에서도 보존한다", () => {
      const live = { provider: "openai", modelId: "gpt-4", apiKey: "sk-live" } as unknown as LlmConfig;
      const migrated = migrateSettingsUi({ llm: live }, 4);
      expect(migrated.llm).toEqual(live);
    });

    it("v5 이상이면 apiKey 없는 llm도 건드리지 않는다", () => {
      const stale = { provider: "openai", modelId: "gpt-4" } as unknown as LlmConfig;
      const migrated = migrateSettingsUi({ llm: stale }, 5);
      expect(migrated.llm).toEqual(stale);
    });
  });

  // API 키가 chrome.storage에 평문으로 남으면 코어 밸류(Privacy)가 깨진다 — 저장 래퍼의 왕복을 고정한다.
  describe("apiKeyObfuscatingStorage", () => {
    const KEY = "bugshot-settings-ui";
    let store: Record<string, string>;

    beforeEach(() => {
      store = {};
      vi.stubGlobal("chrome", {
        storage: {
          local: {
            get: async (name: string) => ({ [name]: store[name] }),
            set: async (obj: Record<string, string>) => {
              Object.assign(store, obj);
            },
            remove: async (name: string) => {
              delete store[name];
            },
          },
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("setItem은 apiKey를 난독화해 저장한다 (평문 미노출)", async () => {
      await apiKeyObfuscatingStorage.setItem(
        KEY,
        JSON.stringify({ state: { llm: { apiKey: "sk-secret-123" } } }),
      );
      expect(store[KEY]).not.toContain("sk-secret-123");
      expect(JSON.parse(store[KEY]).state.llm.apiKey).toMatch(/^obf:/);
    });

    it("getItem은 난독화된 apiKey를 평문으로 되돌린다 (왕복)", async () => {
      await apiKeyObfuscatingStorage.setItem(
        KEY,
        JSON.stringify({ state: { llm: { apiKey: "sk-secret-123" } } }),
      );
      const raw = await apiKeyObfuscatingStorage.getItem(KEY);
      expect(JSON.parse(raw!).state.llm.apiKey).toBe("sk-secret-123");
    });

    it("apiKey가 없으면 상태를 그대로 통과시킨다", async () => {
      await apiKeyObfuscatingStorage.setItem(
        KEY,
        JSON.stringify({ state: { llm: null, theme: "dark" } }),
      );
      const raw = await apiKeyObfuscatingStorage.getItem(KEY);
      expect(JSON.parse(raw!).state).toEqual({ llm: null, theme: "dark" });
    });

    it("저장된 값이 JSON이 아니면 원문 그대로 읽는다", async () => {
      store[KEY] = "not-json";
      expect(await apiKeyObfuscatingStorage.getItem(KEY)).toBe("not-json");
    });

    it("값이 없으면 null을 반환한다", async () => {
      expect(await apiKeyObfuscatingStorage.getItem(KEY)).toBeNull();
    });

    // v4 이전 사용자의 키는 obf: 접두사 없이 평문으로 저장돼 있다 — 그대로 읽혀야 한다.
    it("접두사 없는 legacy 평문 키는 그대로 읽는다", async () => {
      store[KEY] = JSON.stringify({ state: { llm: { apiKey: "sk-legacy" } } });
      const raw = await apiKeyObfuscatingStorage.getItem(KEY);
      expect(JSON.parse(raw!).state.llm.apiKey).toBe("sk-legacy");
    });
  });
});
