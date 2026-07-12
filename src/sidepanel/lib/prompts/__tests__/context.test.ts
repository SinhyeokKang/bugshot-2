import { describe, it, expect } from "vitest";
import type { Token } from "@/types/picker";
import {
  buildClassDeltaLine,
  buildStyleDeltaBlock,
  selectDraftSections,
  extractLayoutContext,
  extractVarRefs,
  includesLogContext,
  LAYOUT_PROPS,
  oneLine,
  selectRelevantTokens,
  selectStyles,
} from "../context";

function token(name: string, value = "0px"): Token {
  return { name, value, category: "length" };
}

describe("extractVarRefs", () => {
  it("스타일 값에서 var(--x) 참조 이름 추출", () => {
    const refs = extractVarRefs({
      color: "var(--brand-500)",
      padding: "8px",
    });
    expect(refs).toEqual(["--brand-500"]);
  });

  it("중첩 var 폴백은 둘 다 추출", () => {
    const refs = extractVarRefs({ color: "var(--a, var(--b))" });
    expect(refs).toEqual(["--a", "--b"]);
  });

  it("한 값에 여러 var 참조", () => {
    const refs = extractVarRefs({
      margin: "var(--space-2) var(--space-4)",
    });
    expect(refs).toEqual(["--space-2", "--space-4"]);
  });

  it("참조 없으면 빈 배열", () => {
    expect(extractVarRefs({ color: "red", padding: "8px" })).toEqual([]);
  });

  it("빈 입력 → 빈 배열", () => {
    expect(extractVarRefs({})).toEqual([]);
  });
});

describe("selectRelevantTokens", () => {
  // 회귀: collectTokens가 이름순 정렬이라 단순 slice는 알파벳 앞 family만 가져간다.
  // 요소가 실제 참조하는 토큰이 뒤쪽 family면 프롬프트에서 사라진다.
  it("참조된 토큰은 알파벳 순서와 무관하게 우선 선별", () => {
    const tokens = [
      token("--aaa-1"),
      token("--aaa-2"),
      token("--aaa-3"),
      token("--zzz-brand"),
    ];
    const result = selectRelevantTokens(tokens, ["--zzz-brand"], 2);
    expect(result.map((t) => t.name)).toContain("--zzz-brand");
    expect(result).toHaveLength(2);
  });

  it("참조 토큰 다음은 같은 family 토큰이 우선", () => {
    const tokens = [
      token("--aaa-1"),
      token("--zzz-100"),
      token("--zzz-200"),
    ];
    const result = selectRelevantTokens(tokens, ["--zzz-100"], 2);
    expect(result.map((t) => t.name)).toEqual(["--zzz-100", "--zzz-200"]);
  });

  it("참조가 없으면 기존 순서대로 limit까지", () => {
    const tokens = [token("--a"), token("--b"), token("--c")];
    const result = selectRelevantTokens(tokens, [], 2);
    expect(result.map((t) => t.name)).toEqual(["--a", "--b"]);
  });

  it("토큰이 limit보다 적으면 전부 반환", () => {
    const tokens = [token("--a")];
    expect(selectRelevantTokens(tokens, [], 5)).toHaveLength(1);
  });

  it("중복 없이 반환 (참조 토큰이 family 패스에서 재등장하지 않음)", () => {
    const tokens = [token("--zzz-100"), token("--zzz-200")];
    const result = selectRelevantTokens(tokens, ["--zzz-100"], 5);
    const names = result.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("selectStyles", () => {
  // 회귀 재현: {...specifiedStyles, ...styleEdits.inlineStyle} spread 순서상
  // 사용자가 새로 추가한 prop이 객체 tail이라 slice(0, limit)가 먼저 버린다.
  it("사용자가 편집한 prop은 cap을 넘겨도 보존된다", () => {
    const styles: Record<string, string> = {};
    for (let i = 0; i < 40; i++) styles[`prop-${i}`] = `${i}px`;
    styles["color"] = "red";
    styles["background-color"] = "blue";

    const result = selectStyles(styles, ["color", "background-color"], 30);

    expect(result).toHaveProperty("color", "red");
    expect(result).toHaveProperty("background-color", "blue");
    expect(Object.keys(result)).toHaveLength(30);
  });

  it("편집 prop이 limit보다 많으면 편집 prop만으로 채운다", () => {
    const styles = { a: "1", b: "2", c: "3", d: "4" };
    const result = selectStyles(styles, ["a", "b", "c"], 2);
    expect(Object.keys(result)).toHaveLength(2);
    for (const key of Object.keys(result)) {
      expect(["a", "b", "c"]).toContain(key);
    }
  });

  it("편집 prop 없으면 기존 순서대로 slice", () => {
    const styles = { a: "1", b: "2", c: "3" };
    expect(selectStyles(styles, [], 2)).toEqual({ a: "1", b: "2" });
  });

  it("styles가 limit 이하면 전부 유지", () => {
    const styles = { a: "1", b: "2" };
    expect(selectStyles(styles, [], 10)).toEqual(styles);
  });

  it("editedProps에 styles에 없는 키가 있어도 무시", () => {
    const styles = { a: "1" };
    expect(selectStyles(styles, ["ghost"], 5)).toEqual({ a: "1" });
  });
});

describe("extractLayoutContext", () => {
  it("레이아웃 관련 prop만 추린다", () => {
    const result = extractLayoutContext({
      display: "flex",
      "flex-direction": "row",
      color: "red",
      "font-size": "14px",
    });
    expect(result).toEqual({ display: "flex", "flex-direction": "row" });
  });

  it("없는 prop은 키 자체를 만들지 않는다", () => {
    const result = extractLayoutContext({ display: "block" });
    expect(Object.keys(result)).toEqual(["display"]);
  });

  it("레이아웃 prop이 하나도 없으면 빈 객체", () => {
    expect(extractLayoutContext({ color: "red" })).toEqual({});
  });

  it("LAYOUT_PROPS에 핵심 레이아웃 축이 포함됨", () => {
    for (const prop of [
      "display",
      "position",
      "flex-direction",
      "justify-content",
      "align-items",
      "gap",
      "box-sizing",
      "overflow",
      "width",
      "height",
      "margin",
      "padding",
    ]) {
      expect(LAYOUT_PROPS).toContain(prop);
    }
  });
});

describe("buildStyleDeltaBlock", () => {
  it("변경 없으면 빈 문자열", () => {
    const styles = { color: "red", padding: "8px" };
    expect(buildStyleDeltaBlock(styles, { ...styles }, styles)).toBe("");
  });

  it("변경된 prop만 포함, 미변경 prop 제외", () => {
    const next = { color: "blue", padding: "8px" };
    const block = buildStyleDeltaBlock(
      { color: "red", padding: "8px" },
      next,
      next,
    );
    expect(block).toContain("color");
    expect(block).toContain("blue");
    expect(block).not.toContain("padding");
  });

  it("새로 추가된 prop 포함", () => {
    const block = buildStyleDeltaBlock({}, { color: "red" }, { color: "red" });
    expect(block).toContain("color");
    expect(block).toContain("red");
  });

  it("삭제된 prop도 제거됐음을 표현", () => {
    const block = buildStyleDeltaBlock({ color: "red" }, {}, {});
    expect(block).toContain("color");
    expect(block).toMatch(/removed|제거/i);
  });

  it("양쪽 다 비면 빈 문자열", () => {
    expect(buildStyleDeltaBlock({}, {}, {})).toBe("");
  });
});

describe("selectDraftSections", () => {
  const strip = (t: string) => t.trim();
  const ENABLED = ["description", "stepsToReproduce", "notes"];

  it("초안 없으면 빈 결과", () => {
    expect(selectDraftSections(undefined, ENABLED, 400, strip)).toEqual({
      parts: [],
      includedIds: [],
      titleIncluded: false,
    });
  });

  it("예산 내면 내용 있는 활성 섹션 전부 포함", () => {
    const { parts, includedIds } = selectDraftSections(
      { title: "T", sections: { description: "d", notes: "n" } },
      ENABLED,
      400,
      strip,
    );
    expect(includedIds).toEqual(["description", "notes"]);
    expect(parts[0]).toContain("title: T");
  });

  it("빈 섹션은 includedIds에 안 들어간다", () => {
    const { includedIds } = selectDraftSections(
      { title: "", sections: { description: "d", notes: "   " } },
      ENABLED,
      400,
      strip,
    );
    expect(includedIds).toEqual(["description"]);
  });

  // 회귀: 블록을 통째로 slice하면 잘려나간 섹션이 "실렸다"고 보고돼,
  // 나노가 그 섹션에 빈 문자열을 반환할 때 병합이 사용자 텍스트를 삭제했다.
  it("예산 초과 섹션은 통째로 빠지고 includedIds에도 없다 (중간 절단 없음)", () => {
    const { parts, includedIds } = selectDraftSections(
      {
        title: "",
        sections: {
          description: "d".repeat(350),
          stepsToReproduce: "s".repeat(100),
          notes: "n",
        },
      },
      ENABLED,
      400,
      strip,
    );
    expect(includedIds).toContain("description");
    expect(includedIds).not.toContain("stepsToReproduce");
    expect(parts.join("\n")).not.toContain("s".repeat(100));
    // 예산이 남으면 뒤 섹션도 실린다
    expect(includedIds).toContain("notes");
  });

  it("실린 파트와 includedIds가 항상 정합", () => {
    const { parts, includedIds } = selectDraftSections(
      { title: "", sections: { description: "d".repeat(500) } },
      ENABLED,
      400,
      strip,
    );
    expect(includedIds).toEqual([]);
    expect(parts).toEqual([]);
  });
});

describe("buildStyleDeltaBlock — 캡 축출 vs 실제 삭제", () => {
  // 회귀: prev/next가 캡 적용 후 맵이라, 캡 윈도 밖으로 밀려난 prop을
  // "(removed)"로 통보하면 모델이 멀쩡한 속성을 되살린다.
  it("캡에서 밀려났을 뿐 실제로 남아있는 prop은 (removed)로 표시하지 않는다", () => {
    const block = buildStyleDeltaBlock(
      { color: "red" },
      {},
      { color: "red", padding: "8px" },
    );
    expect(block).not.toMatch(/removed/);
  });

  it("실제로 사라진 prop은 (removed)로 표시", () => {
    const block = buildStyleDeltaBlock({ color: "red" }, {}, { padding: "8px" });
    expect(block).toContain("color");
    expect(block).toMatch(/removed/);
  });
});

describe("buildClassDeltaLine", () => {
  it("변경 없으면 빈 문자열", () => {
    expect(buildClassDeltaLine(["a", "b"], ["a", "b"])).toBe("");
  });

  it("변경되면 완전한 클래스 목록을 싣는다", () => {
    const line = buildClassDeltaLine(["a"], ["a", "b"]);
    expect(line).toContain("a b");
  });

  it("전부 제거되면 (none)", () => {
    expect(buildClassDeltaLine(["a"], [])).toContain("(none)");
  });
});

describe("oneLine", () => {
  it("개행을 공백으로 접어 한 줄로 만든다", () => {
    expect(oneLine("a\nb")).toBe("a b");
    expect(oneLine("a\r\n\r\nb")).toBe("a b");
  });

  it("빈 문자열·개행 없는 문자열은 그대로", () => {
    expect(oneLine("")).toBe("");
    expect(oneLine("plain")).toBe("plain");
  });

  it("U+2028/U+2029(줄 구분자)도 접는다", () => {
    expect(oneLine("a b c")).toBe("a b c");
  });
});

describe("includesLogContext", () => {
  it("video·freeform에서만 로그를 싣는다", () => {
    expect(includesLogContext("video")).toBe(true);
    expect(includesLogContext("freeform")).toBe(true);
    expect(includesLogContext("element")).toBe(false);
    expect(includesLogContext("screenshot")).toBe(false);
  });
});
