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

  // code-collapse.css의 max-height를 실제로 읽어 계산한다 — 산식을 테스트에 복제하면
  // CSS가 바뀌어도 green이라 아무것도 못 잡는다.
  // 접힘 높이가 임계값+1줄의 자연 높이 이상이면 "안 잘리는데 pill만 뜨고 클릭해도 변화가
  // 없는" 유령 접힘이 된다. 스크롤바 10px을 상수로 더했다가 정확히 이게 터진 적이 있다.
  it("CSS 접힘 높이가 임계값+1줄을 실제로 자른다 (유령 접힘 방지)", () => {
    const cssPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../components/code-collapse.css",
    );
    const calc = readFileSync(cssPath, "utf8").match(/max-height:\s*calc\(([^;]+)\);/)?.[1];
    expect(calc).toBeDefined();

    // pre는 font-size 12px · line-height 1.5 · padding 1em (doc-section-body.css / tiptap-editor.css).
    // box-sizing: border-box라 max-height가 padding 상하를 포함한다.
    const PRE_FONT_PX = 12;
    const LINE_PX = 1.5 * PRE_FONT_PX;
    const PADDING_PX = 2 * PRE_FONT_PX;

    const collapsedPx = [
      ...calc!.matchAll(/(?:var\(--code-collapse-lines\)\s*\*\s*)?([\d.]+)(em|px)/g),
    ].reduce((sum, [whole, n, unit]) => {
      const value = unit === "em" ? Number(n) * PRE_FONT_PX : Number(n);
      return sum + (whole.startsWith("var(") ? value * CODE_COLLAPSE_LINE_THRESHOLD : value);
    }, 0);

    // 임계값 줄 수는 온전히 보이고(하한) 그다음 줄은 반드시 잘린다(상한).
    // 그 사이 여백(현재 0.75em = 16번째 줄 절반)은 자유롭게 튜닝할 수 있어야 한다.
    expect(collapsedPx).toBeGreaterThanOrEqual(
      CODE_COLLAPSE_LINE_THRESHOLD * LINE_PX + PADDING_PX,
    );
    expect(collapsedPx).toBeLessThan((CODE_COLLAPSE_LINE_THRESHOLD + 1) * LINE_PX + PADDING_PX);
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
