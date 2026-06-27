import { describe, expect, it } from "vitest";
import type { EditorStyleEdits } from "@/store/editor-store";
import type { Token } from "@/types/picker";
import type { AiStylingEdits } from "../buildAiStylingPrompt";
import { mergeAiEdits, replaceRawWithTokens } from "../aiStylingPostProcess";

describe("mergeAiEdits", () => {
  const base: EditorStyleEdits = {
    inlineStyle: { color: "red", padding: "8px" },
    classList: ["btn"],
    text: "hello",
  };

  it("inlineStyle을 머지 (기존 유지 + 새 값 덮어쓰기)", () => {
    const edits: AiStylingEdits = { inlineStyle: { color: "blue", margin: "4px" } };
    const result = mergeAiEdits(base, edits);
    expect(result.inlineStyle).toEqual({ color: "blue", padding: "8px", margin: "4px" });
  });

  it("classList 교체", () => {
    const edits: AiStylingEdits = { classList: ["card", "active"] };
    const result = mergeAiEdits(base, edits);
    expect(result.classList).toEqual(["card", "active"]);
  });

  it("text는 항상 current 유지", () => {
    const edits: AiStylingEdits = { inlineStyle: {} };
    expect(mergeAiEdits(base, edits).text).toBe("hello");
  });

  it("edits가 비어있으면 원본 유지", () => {
    const result = mergeAiEdits(base, {});
    expect(result.inlineStyle).toEqual(base.inlineStyle);
    expect(result.classList).toEqual(base.classList);
  });

  it("AI shorthand는 기존 longhand를 밀어낸다 (중복 diff 행 방지)", () => {
    const current: EditorStyleEdits = {
      inlineStyle: {
        "padding-top": "12px",
        "padding-right": "12px",
        "padding-bottom": "12px",
        "padding-left": "12px",
        color: "red",
      },
      classList: ["btn"],
      text: "",
    };
    const result = mergeAiEdits(current, { inlineStyle: { padding: "8px" } });
    expect(result.inlineStyle).toEqual({ padding: "8px", color: "red" });
  });

  it("AI longhand는 기존 shorthand와 공존한다 (한 면 덮어쓰기)", () => {
    const result = mergeAiEdits(base, {
      inlineStyle: { "padding-top": "4px" },
    });
    expect(result.inlineStyle).toEqual({
      color: "red",
      padding: "8px",
      "padding-top": "4px",
    });
  });

  it("AI gap shorthand는 기존 row-gap/column-gap longhand를 제거", () => {
    const current = {
      inlineStyle: { "row-gap": "4px", "column-gap": "8px", color: "red" },
      classList: [],
      text: "",
    };
    const result = mergeAiEdits(current, { inlineStyle: { gap: "12px" } });
    expect(result.inlineStyle).toEqual({ gap: "12px", color: "red" });
  });

  it("AI border shorthand는 기존 border longhand·sub-shorthand를 제거", () => {
    const current = {
      inlineStyle: {
        "border-top-color": "red",
        "border-width": "2px",
        "border-left-style": "dashed",
        color: "blue",
      },
      classList: [],
      text: "",
    };
    const result = mergeAiEdits(current, {
      inlineStyle: { border: "1px solid black" },
    });
    expect(result.inlineStyle).toEqual({
      border: "1px solid black",
      color: "blue",
    });
  });

  it("AI background shorthand는 기존 background-color longhand를 제거", () => {
    const current = {
      inlineStyle: { "background-color": "red", padding: "8px" },
      classList: [],
      text: "",
    };
    const result = mergeAiEdits(current, {
      inlineStyle: { background: "url(x.png) center / cover" },
    });
    expect(result.inlineStyle).toEqual({
      background: "url(x.png) center / cover",
      padding: "8px",
    });
  });
});

describe("replaceRawWithTokens", () => {
  const tokens: Token[] = [
    { name: "--spacing-4", value: "16px", category: "length" },
    { name: "--color-primary", value: "#0066ff", category: "color" },
  ];

  it("exact value match → var() 치환", () => {
    const result = replaceRawWithTokens(
      { padding: "16px" },
      tokens,
      { padding: "var(--spacing-4)" },
    );
    expect(result.padding).toBe("var(--spacing-4)");
  });

  it("이미 var() 참조면 그대로 유지", () => {
    const result = replaceRawWithTokens(
      { padding: "var(--spacing-4)" },
      tokens,
      {},
    );
    expect(result.padding).toBe("var(--spacing-4)");
  });

  it("매칭 토큰 없으면 원본 값 유지", () => {
    const result = replaceRawWithTokens(
      { margin: "999px" },
      tokens,
      {},
    );
    expect(result.margin).toBe("999px");
  });
});
