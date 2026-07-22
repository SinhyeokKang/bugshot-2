import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiKeyObfuscatingStorage,
  DEFAULT_ISSUE_SECTIONS,
  migrateSettingsUi,
  normalizeSections,
  sectionHelpKey,
  sectionLabelKey,
  sectionMdLabelKey,
  sectionPlaceholderKey,
  useSettingsUiStore,
  type IssueSection,
  type IssueSectionId,
  type TextSectionId,
  type LlmConfig,
} from "../settings-ui-store";

const section = (
  id: IssueSectionId,
  enabled = true,
  renderAs: IssueSection["renderAs"] = "paragraph",
): IssueSection => ({ id, enabled, renderAs, builtIn: true });

const ids = (sections: IssueSection[]) => sections.map((s) => s.id);

describe("settings-ui-store", () => {
  describe("DEFAULT_ISSUE_SECTIONS", () => {
    it("5종 빌트인 항목이 올바른 순서로 정의됨 (미디어는 재현과정과 기대결과 사이)", () => {
      expect(ids(DEFAULT_ISSUE_SECTIONS)).toEqual([
        "description",
        "stepsToReproduce",
        "media",
        "expectedResult",
        "notes",
      ]);
    });

    it("notes만 disabled, 나머지는 enabled (media는 항상 enabled)", () => {
      const map = Object.fromEntries(DEFAULT_ISSUE_SECTIONS.map((s) => [s.id, s.enabled]));
      expect(map).toEqual({
        description: true,
        stepsToReproduce: true,
        media: true,
        expectedResult: true,
        notes: false,
      });
    });

    it("stepsToReproduce는 orderedList, media는 meta, 나머지는 paragraph", () => {
      const map = Object.fromEntries(DEFAULT_ISSUE_SECTIONS.map((s) => [s.id, s.renderAs]));
      expect(map).toEqual({
        description: "paragraph",
        stepsToReproduce: "orderedList",
        media: "meta",
        expectedResult: "paragraph",
        notes: "paragraph",
      });
    });
  });

  // 미디어 엔트리는 "정확히 1개" 불변식을 가진다 — 없으면 본문에서 미디어가 소실되고,
  // 2개면 중복 렌더된다. 마이그레이션·rehydrate 공용 방어선.
  describe("normalizeSections", () => {
    it("미디어가 없으면 레거시 앵커(첫 enabled post-media 섹션 직전)에 삽입한다", () => {
      const legacy = [
        section("description"),
        section("stepsToReproduce", true, "orderedList"),
        section("expectedResult"),
        section("notes", false),
      ];
      expect(ids(normalizeSections(legacy))).toEqual([
        "description",
        "stepsToReproduce",
        "media",
        "expectedResult",
        "notes",
      ]);
    });

    it("expectedResult가 비활성이면 첫 enabled post-media인 notes 앞에 삽입한다", () => {
      const legacy = [
        section("description"),
        section("expectedResult", false),
        section("notes", true),
      ];
      expect(ids(normalizeSections(legacy))).toEqual([
        "description",
        "expectedResult",
        "media",
        "notes",
      ]);
    });

    it("enabled인 post-media 섹션이 없으면 말미에 붙인다", () => {
      const legacy = [
        section("description"),
        section("expectedResult", false),
        section("notes", false),
      ];
      expect(ids(normalizeSections(legacy))).toEqual([
        "description",
        "expectedResult",
        "notes",
        "media",
      ]);
    });

    it("미디어가 이미 1개면 위치를 보존한다 (사용자가 정한 순서 존중)", () => {
      const reordered = [
        section("media", true, "meta"),
        section("description"),
        section("expectedResult"),
      ];
      expect(ids(normalizeSections(reordered))).toEqual([
        "media",
        "description",
        "expectedResult",
      ]);
    });

    it("미디어가 2개 이상이면 첫 항목만 남긴다", () => {
      const dirty = [
        section("description"),
        section("media", true, "meta"),
        section("expectedResult"),
        section("media", true, "meta"),
      ];
      expect(ids(normalizeSections(dirty))).toEqual([
        "description",
        "media",
        "expectedResult",
      ]);
    });

    it("enabled:false로 오염된 미디어는 true로 강제한다", () => {
      const dirty = [section("description"), section("media", false, "meta")];
      const out = normalizeSections(dirty);
      expect(out.find((s) => s.id === "media")?.enabled).toBe(true);
    });

    it("멱등하다 (두 번 돌려도 결과 동일)", () => {
      const legacy = [
        section("description"),
        section("stepsToReproduce", true, "orderedList"),
        section("expectedResult"),
        section("notes", false),
      ];
      const once = normalizeSections(legacy);
      expect(normalizeSections(once)).toEqual(once);
    });

    it("빈 배열이면 미디어 하나만 남는다", () => {
      expect(ids(normalizeSections([]))).toEqual(["media"]);
    });

    it("입력 배열을 변형하지 않는다 (순수 함수)", () => {
      const input = [section("description"), section("expectedResult")];
      const snapshot = JSON.parse(JSON.stringify(input));
      normalizeSections(input);
      expect(input).toEqual(snapshot);
    });
  });

  describe("section key 헬퍼", () => {
    const ids: TextSectionId[] = ["description", "stepsToReproduce", "expectedResult", "notes"];

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

    it("setIssueEnabled('media')는 무시된다 (미디어 카드엔 사용 여부 스위치가 없다)", () => {
      useSettingsUiStore.getState().resetIssueSections();
      useSettingsUiStore.getState().setIssueEnabled("media", false);
      const media = useSettingsUiStore.getState().issueSections.find((s) => s.id === "media");
      expect(media?.enabled).toBe(true);
    });

    it("resetIssueSections로 기본값 복원", () => {
      useSettingsUiStore.getState().setIssueEnabled("notes", true);
      useSettingsUiStore.getState().setIssueEnabled("description", false);
      useSettingsUiStore.getState().resetIssueSections();
      expect(useSettingsUiStore.getState().issueSections).toEqual(DEFAULT_ISSUE_SECTIONS);
    });

    it("reorderIssueSections로 순서 변경 (미디어를 맨 앞으로)", () => {
      useSettingsUiStore.getState().resetIssueSections();
      const from = DEFAULT_ISSUE_SECTIONS.findIndex((s) => s.id === "media");
      useSettingsUiStore.getState().reorderIssueSections(from, 0);
      expect(ids(useSettingsUiStore.getState().issueSections)).toEqual([
        "media",
        "description",
        "stepsToReproduce",
        "expectedResult",
        "notes",
      ]);
    });

    it("reorderIssueSections는 뒤로 옮길 때도 나머지 상대 순서를 보존한다", () => {
      useSettingsUiStore.getState().resetIssueSections();
      useSettingsUiStore.getState().reorderIssueSections(0, 4);
      expect(ids(useSettingsUiStore.getState().issueSections)).toEqual([
        "stepsToReproduce",
        "media",
        "expectedResult",
        "notes",
        "description",
      ]);
    });

    it("reorderIssueSections는 enabled 등 섹션 속성을 보존한다", () => {
      useSettingsUiStore.getState().resetIssueSections();
      useSettingsUiStore.getState().reorderIssueSections(4, 0);
      const notes = useSettingsUiStore.getState().issueSections[0];
      expect(notes).toEqual(DEFAULT_ISSUE_SECTIONS.find((s) => s.id === "notes"));
    });

    it("reorderIssueSections는 범위 밖 인덱스에서 no-op (배열 파괴 방지)", () => {
      useSettingsUiStore.getState().resetIssueSections();
      useSettingsUiStore.getState().reorderIssueSections(-1, 2);
      useSettingsUiStore.getState().reorderIssueSections(0, 99);
      useSettingsUiStore.getState().reorderIssueSections(99, 0);
      expect(useSettingsUiStore.getState().issueSections).toEqual(DEFAULT_ISSUE_SECTIONS);
    });

    // 복원 버튼은 "순서"만 되돌린다 — 사용자가 끈 섹션이 조용히 켜지면 안 된다.
    it("resetIssueSectionOrder는 순서만 기본값으로 되돌리고 enabled는 보존한다", () => {
      useSettingsUiStore.getState().resetIssueSections();
      useSettingsUiStore.getState().setIssueEnabled("notes", true);
      useSettingsUiStore.getState().setIssueEnabled("description", false);
      useSettingsUiStore.getState().reorderIssueSections(2, 0);

      useSettingsUiStore.getState().resetIssueSectionOrder();

      const after = useSettingsUiStore.getState().issueSections;
      expect(ids(after)).toEqual(ids(DEFAULT_ISSUE_SECTIONS));
      const map = Object.fromEntries(after.map((s) => [s.id, s.enabled]));
      expect(map).toEqual({
        description: false,
        stepsToReproduce: true,
        media: true,
        expectedResult: true,
        notes: true,
      });
    });

    it("resetIssueSectionOrder는 기본 배열에 없는 항목을 잃지 않는다", () => {
      useSettingsUiStore.setState({
        issueSections: [
          section("notes"),
          { ...section("custom" as IssueSectionId), builtIn: true },
          section("description"),
        ],
      });
      useSettingsUiStore.getState().resetIssueSectionOrder();
      expect(ids(useSettingsUiStore.getState().issueSections)).toContain("custom");
      useSettingsUiStore.getState().resetIssueSections();
    });

    it("reorderIssueSections(from===to)는 no-op", () => {
      useSettingsUiStore.getState().resetIssueSections();
      useSettingsUiStore.getState().reorderIssueSections(2, 2);
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

  // v8 사용자는 순서 배열에 미디어 엔트리가 없다 → 레거시 앵커 위치로 backfill해
  // 마이그레이션 직후 본문 레이아웃이 변하지 않게 한다.
  describe("미디어 엔트리 마이그레이션 (v8→v9)", () => {
    it("v8 저장 순서에 미디어를 정확히 1개 삽입한다", () => {
      const v8 = [
        section("description"),
        section("stepsToReproduce", true, "orderedList"),
        section("expectedResult"),
        section("notes", false),
      ];
      const migrated = migrateSettingsUi({ issueSections: v8 }, 8);
      expect(ids(migrated.issueSections)).toEqual([
        "description",
        "stepsToReproduce",
        "media",
        "expectedResult",
        "notes",
      ]);
    });

    it("v8의 사용자 enabled 설정을 보존한다", () => {
      const v8 = [
        section("description", false),
        section("stepsToReproduce", true, "orderedList"),
        section("expectedResult"),
        section("notes", true),
      ];
      const migrated = migrateSettingsUi({ issueSections: v8 }, 8);
      const map = Object.fromEntries(migrated.issueSections.map((s) => [s.id, s.enabled]));
      expect(map).toEqual({
        description: false,
        stepsToReproduce: true,
        media: true,
        expectedResult: true,
        notes: true,
      });
    });

    it("이미 v9인 상태(미디어 1개)는 순서를 그대로 둔다", () => {
      const v9 = [
        section("media", true, "meta"),
        section("description"),
        section("expectedResult"),
      ];
      const migrated = migrateSettingsUi({ issueSections: v9 }, 9);
      expect(ids(migrated.issueSections)).toEqual(["media", "description", "expectedResult"]);
    });
  });

  describe("초기 마이그레이션 분기 (v1→v5)", () => {
    it("v1에서 올라오면 issueSections 기본값을 주입한다", () => {
      const migrated = migrateSettingsUi({}, 1);
      expect(migrated.issueSections).toEqual(DEFAULT_ISSUE_SECTIONS);
    });

    it("issueSections가 이미 있으면 보존한다 (미디어 엔트리만 정규화로 보강)", () => {
      const custom = [{ ...DEFAULT_ISSUE_SECTIONS[0], enabled: false }];
      const migrated = migrateSettingsUi({ issueSections: custom }, 2);
      expect(migrated.issueSections).toEqual([...custom, section("media", true, "meta")]);
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
