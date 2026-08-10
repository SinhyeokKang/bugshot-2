import { describe, it, expect } from "vitest";
import {
  AI_LANGUAGE_OPTIONS,
  aiLanguageLabel,
  normalizeAiLanguage,
  resolveAiLanguage,
} from "../aiLanguage";

describe("AI_LANGUAGE_OPTIONS", () => {
  it("프리셋 9개를 프롬프트용 영어 이름으로 노출한다 (auto는 미포함 — UI가 별도 행으로 얹는다)", () => {
    expect(AI_LANGUAGE_OPTIONS.map((o) => o.value)).toEqual([
      "English",
      "Korean",
      "Japanese",
      "Chinese (Simplified)",
      "Spanish",
      "French",
      "German",
      "Portuguese (Brazil)",
      "Russian",
    ]);
  });

  it("label은 자기 언어 표기다 (셀렉터에서 모국어로 읽히게)", () => {
    const labels = Object.fromEntries(
      AI_LANGUAGE_OPTIONS.map((o) => [o.value, o.label]),
    );
    expect(labels).toEqual({
      English: "English",
      Korean: "한국어",
      Japanese: "日本語",
      "Chinese (Simplified)": "中文(简体)",
      Spanish: "Español",
      French: "Français",
      German: "Deutsch",
      "Portuguese (Brazil)": "Português (Brasil)",
      Russian: "Русский",
    });
  });
});

describe("resolveAiLanguage", () => {
  it("auto는 UI 로케일을 따른다", () => {
    expect(resolveAiLanguage("auto", "ko")).toBe("Korean");
    expect(resolveAiLanguage("auto", "en")).toBe("English");
  });

  it("명시 선택은 UI 로케일과 무관하게 그 값이다", () => {
    expect(resolveAiLanguage("French", "ko")).toBe("French");
    expect(resolveAiLanguage("Korean", "en")).toBe("Korean");
    expect(resolveAiLanguage("English", "ko")).toBe("English");
  });

  // auto를 연결 시점 스냅샷으로 굳히면 UI 언어를 바꿔도 AI만 옛 언어로 남는다.
  it("auto는 스냅샷이 아니라 호출 시점 해석이다 (같은 값, 로케일만 바뀌면 결과가 바뀐다)", () => {
    const stored = "auto" as const;
    expect(resolveAiLanguage(stored, "en")).toBe("English");
    expect(resolveAiLanguage(stored, "ko")).toBe("Korean");
  });

  it("undefined(설정 이전 상태)는 auto로 취급한다", () => {
    expect(resolveAiLanguage(undefined, "ko")).toBe("Korean");
    expect(resolveAiLanguage(undefined, "en")).toBe("English");
  });

  // 값이 프롬프트 지시문에 그대로 박히므로 오염된 storage가 임의 문자열을 실어보내면 안 된다.
  it("알 수 없는 값은 auto로 폴백한다", () => {
    expect(resolveAiLanguage("Klingon" as never, "ko")).toBe("Korean");
    expect(resolveAiLanguage("" as never, "en")).toBe("English");
  });
});

describe("normalizeAiLanguage", () => {
  it("유효한 프리셋과 auto는 보존한다", () => {
    expect(normalizeAiLanguage("French")).toBe("French");
    expect(normalizeAiLanguage("auto")).toBe("auto");
  });

  it("알 수 없는 값·비문자열은 auto로 정규화한다", () => {
    expect(normalizeAiLanguage("Klingon")).toBe("auto");
    expect(normalizeAiLanguage(undefined)).toBe("auto");
    expect(normalizeAiLanguage(null)).toBe("auto");
    expect(normalizeAiLanguage(42)).toBe("auto");
    expect(normalizeAiLanguage("french")).toBe("auto"); // 대소문자 관용 없음 — 프롬프트에 박히는 값이다
  });
});

describe("aiLanguageLabel", () => {
  it("프리셋을 자기 언어 표기로 되돌린다 (셀렉터의 '자동 (…)' 라벨 소스)", () => {
    expect(aiLanguageLabel("Korean")).toBe("한국어");
    expect(aiLanguageLabel("French")).toBe("Français");
    expect(aiLanguageLabel("English")).toBe("English");
  });

  // English만 value===label이라 조회 축이 뒤집혀도 그 케이스는 통과한다 — 축이 다른 값으로 잰다.
  it("label이 아니라 value로 조회한다", () => {
    expect(aiLanguageLabel("Japanese")).toBe("日本語");
    expect(() => aiLanguageLabel("日本語" as never)).toThrow();
  });
});
