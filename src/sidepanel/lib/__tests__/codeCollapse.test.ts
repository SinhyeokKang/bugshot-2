import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  CODE_COLLAPSE_LINE_THRESHOLD,
  countCodeLines,
  shouldCollapseCode,
} from "../codeCollapse";

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
}

describe("countCodeLines", () => {
  it("개행으로 구분된 줄 수를 센다", () => {
    expect(countCodeLines("a\nb\nc")).toBe(3);
  });

  it("후행 개행 1개는 제거하고 센다 — markdown-it(붙임)과 ProseMirror(안 붙임)가 같은 숫자를 내야 한다", () => {
    expect(countCodeLines("a\nb")).toBe(2);
    expect(countCodeLines("a\nb\n")).toBe(2);
  });

  it("후행 개행은 1개만 제거한다 — 의도적 빈 줄은 살린다", () => {
    expect(countCodeLines("a\nb\n\n")).toBe(3);
  });

  it("빈 문자열과 단일 줄은 1줄이다", () => {
    expect(countCodeLines("")).toBe(1);
    expect(countCodeLines("a")).toBe(1);
  });
});

describe("shouldCollapseCode", () => {
  it("임계값은 15다", () => {
    expect(CODE_COLLAPSE_LINE_THRESHOLD).toBe(15);
  });

  // 접힘 높이는 세 파일에 걸쳐 있다 — code-collapse.css의 calc가 doc-section-body.css /
  // tiptap-editor.css의 pre 값(font-size·line-height·padding)에 침묵으로 의존한다.
  // 어느 하나라도 테스트에 복제하면 그 파일이 바뀌어도 green이라 못 잡으므로 전부 읽어낸다.
  const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "../../components");

  function preStyle(file: string, selector: string) {
    // 주석부터 걷어낸다 — tiptap-editor.css의 pre 규칙 주석이 `pre { white-space: pre-wrap }`을
    // 품고 있어, 안 걷으면 그 `}`에서 규칙이 잘린다.
    const css = readFileSync(join(componentsDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const body = css.split(`${selector} {`)[1]?.split("}")[0];
    expect(body, `${selector} 규칙을 ${file}에서 못 찾음`).toBeDefined();
    const decl = (prop: string) => {
      const value = body!.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1]?.trim();
      // 값이 사라져도 통과하면(예: padding → padding-block 분리) 대조가 공허해진다.
      expect(value, `${file}의 ${selector}에 ${prop} 선언이 없음`).toBeDefined();
      return value!;
    };
    return { fontSize: decl("font-size"), lineHeight: decl("line-height"), padding: decl("padding") };
  }

  it("두 표면의 pre 규칙이 접힘 높이 산식의 전제를 똑같이 유지한다", () => {
    expect(preStyle("doc-section-body.css", ".doc-section-body pre")).toEqual(
      preStyle("tiptap-editor.css", ".tiptap-editor .ProseMirror pre"),
    );
  });

  // 접힘 높이가 임계값+1줄의 자연 높이 이상이면 "안 잘리는데 pill만 뜨고 클릭해도 변화가
  // 없는" 유령 접힘이 된다. 스크롤바 10px을 상수로 더했다가 정확히 이게 터진 적이 있다.
  it("CSS 접힘 높이가 임계값+1줄을 실제로 자른다 (유령 접힘 방지)", () => {
    const pre = preStyle("doc-section-body.css", ".doc-section-body pre");
    const fontPx = Number(pre.fontSize.replace("px", ""));
    const linePx = Number(pre.lineHeight) * fontPx;
    // box-sizing: border-box라 max-height가 padding 상하를 포함한다.
    const paddingPx = 2 * Number(pre.padding.replace("em", "")) * fontPx;

    const calc = readFileSync(join(componentsDir, "code-collapse.css"), "utf8")
      .match(/max-height:\s*calc\(([^;]+)\);/)?.[1];
    expect(calc).toBeDefined();

    // 아래 리듀서는 `<n><em|px>` 항의 덧셈만 안다 — 빼기나 다른 단위가 들어오면 조용히
    // 오판정하므로, 파서가 다루는 형태를 벗어나면 여기서 먼저 멈춘다.
    expect(calc!.replace(/var\([^)]*\)/g, "")).not.toMatch(/-|rem|ch|%/);

    const collapsedPx = [
      ...calc!.matchAll(/(?:var\(--code-collapse-lines\)\s*\*\s*)?([\d.]+)(em|px)/g),
    ].reduce((sum, [whole, n, unit]) => {
      const value = unit === "em" ? Number(n) * fontPx : Number(n);
      return sum + (whole.startsWith("var(") ? value * CODE_COLLAPSE_LINE_THRESHOLD : value);
    }, 0);

    // 임계값 줄 수는 온전히 보이고(하한) 그다음 줄은 반드시 잘린다(상한).
    // 그 사이 여백(현재 0.75em = 다음 줄 절반)은 자유롭게 튜닝할 수 있어야 한다.
    expect(collapsedPx).toBeGreaterThanOrEqual(CODE_COLLAPSE_LINE_THRESHOLD * linePx + paddingPx);
    expect(collapsedPx).toBeLessThan((CODE_COLLAPSE_LINE_THRESHOLD + 1) * linePx + paddingPx);
  });

  it("15줄은 안 접고 16줄부터 접는다", () => {
    expect(shouldCollapseCode(15)).toBe(false);
    expect(shouldCollapseCode(16)).toBe(true);
  });
});

describe("countCodeLines + shouldCollapseCode", () => {
  it("정확히 15줄인 블럭은 안 접힌다", () => {
    expect(shouldCollapseCode(countCodeLines(lines(15)))).toBe(false);
  });

  it("정확히 16줄인 블럭은 접힌다", () => {
    expect(shouldCollapseCode(countCodeLines(lines(16)))).toBe(true);
  });

  it("후행 개행이 붙은 15줄 블럭도 안 접힌다 — 후행 개행이 임계값을 넘기면 안 된다", () => {
    expect(shouldCollapseCode(countCodeLines(`${lines(15)}\n`))).toBe(false);
  });
});
