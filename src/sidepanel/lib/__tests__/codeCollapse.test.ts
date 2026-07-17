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
    return {
      background: decl("background"),
      fontSize: decl("font-size"),
      lineHeight: decl("line-height"),
      padding: decl("padding"),
      border: decl("border"),
      borderRadius: decl("border-radius"),
    };
  }

  // 에딧(tiptap)과 읽기(doc-section-body)의 pre는 **손복사본 2벌**이다 — 공유가 아니라 클론이라
  // 한쪽만 고치면 같은 코드블럭이 편집 화면과 프리뷰에서 다르게 보인다. 높이 산식의 전제
  // (font-size·line-height·padding·border)뿐 아니라 배경·라운드까지 함께 묶어야 시각 드리프트도
  // 잡힌다. tiptap 쪽 white-space: pre 한 줄만 의도된 예외(주석은 파서가 걷어낸다).
  it("에딧·읽기 두 표면의 pre 규칙이 동일하다", () => {
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
    const px = (v: string) =>
      v.trim().endsWith("em") ? Number(v.replace("em", "")) * fontPx : Number(v.replace("px", ""));

    const collapseCss = readFileSync(join(componentsDir, "code-collapse.css"), "utf8");
    const collapsedRule = collapseCss.split('[data-collapsed="true"] pre {')[1]?.split("}")[0];
    expect(collapsedRule, "접힘 pre 규칙을 못 찾음").toBeDefined();

    const calc = collapsedRule!.match(/max-height:\s*calc\(([^;]+)\);/)?.[1];
    expect(calc).toBeDefined();
    // 아래 리듀서는 `<n><em|px>` 항의 덧셈만 안다 — 빼기나 다른 단위가 들어오면 조용히
    // 오판정하므로, 파서가 다루는 형태를 벗어나면 여기서 먼저 멈춘다.
    expect(calc!.replace(/var\([^)]*\)/g, "")).not.toMatch(/-|rem|ch|%/);

    const boxPx = [
      ...calc!.matchAll(/(?:var\(--code-collapse-lines\)\s*\*\s*)?([\d.]+)(em|px)/g),
    ].reduce((sum, [whole, n, unit]) => {
      const value = unit === "em" ? Number(n) * fontPx : Number(n);
      return sum + (whole.startsWith("var(") ? value * CODE_COLLAPSE_LINE_THRESHOLD : value);
    }, 0);

    // box-sizing: border-box라 max-height가 패딩·테두리를 포함한다 → 빼야 실제로 보이는 높이다.
    // 접힘 규칙은 아래 패딩을 0으로 죽인다(페이드가 여백이 아니라 글자를 덮게).
    const padBottom = collapsedRule!.match(/padding-bottom:\s*([^;]+);/)?.[1] ?? pre.padding;
    const visiblePx =
      boxPx - px(pre.padding) - px(padBottom) - px(pre.border.split(/\s+/)[0]) * 2;

    // 임계값 줄 수는 온전히 보이고(하한) 그다음 줄은 반드시 잘린다(상한).
    // 그 사이 여백(현재 0.75em = 다음 줄 절반)은 자유롭게 튜닝할 수 있어야 한다.
    expect(visiblePx).toBeGreaterThanOrEqual(CODE_COLLAPSE_LINE_THRESHOLD * linePx);
    expect(visiblePx).toBeLessThan((CODE_COLLAPSE_LINE_THRESHOLD + 1) * linePx);
  });

  it("15줄은 안 접고 16줄부터 접는다", () => {
    expect(shouldCollapseCode(15)).toBe(false);
    expect(shouldCollapseCode(16)).toBe(true);
  });
});

// pill(.code-collapse-toggle)과 블럭 액션 버튼(.block-actions-button)은 같은 shadcn outline
// 관용구의 vanilla 재현 2벌인데 클래스를 공유하지 않는다 — 한쪽만 고치면 조용히 갈라진다.
// border-radius(ButtonGroup 모서리 합침)와 transition 대상 속성(등장 vs 글자색)만 의도된 차이.
describe("pill·block-actions 버튼 관용구 대조", () => {
  const componentsDir = join(dirname(fileURLToPath(import.meta.url)), "../../components");

  function bodies(file: string, selector: string): string[] {
    const css = readFileSync(join(componentsDir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const found = css.split(`${selector} {`).slice(1).map((s) => s.split("}")[0]);
    expect(found.length, `${selector} 규칙을 ${file}에서 못 찾음`).toBeGreaterThan(0);
    return found;
  }

  function decl(body: string, prop: string, ctx: string): string {
    const value = body.match(new RegExp(`(?:^|[^-\\w])${prop}:\\s*([^;]+);`))?.[1]?.trim();
    expect(value, `${ctx}에 ${prop} 선언이 없음`).toBeDefined();
    return value!;
  }

  // 수집 시점이 아니라 it 안에서 읽는다 — 여기서 throw하면 파일 전체가 수집 실패로 뭉개진다.
  const toggle = () => bodies("code-collapse.css", ".code-collapse-toggle")[0];
  const button = () => bodies("block-actions.css", ".block-actions-button")[0];

  it("기본 상태의 테두리·배경·글자색·그림자가 일치한다", () => {
    for (const prop of ["border", "background", "color", "box-shadow"]) {
      expect(decl(button(), prop, "block-actions-button")).toBe(decl(toggle(), prop, "toggle"));
    }
  });

  it("transition 시간·곡선이 일치한다 (대상 속성만 의도된 차이)", () => {
    const curve = (body: string, ctx: string) =>
      decl(body, "transition", ctx).replace(/^\S+\s+/, "");
    expect(curve(button(), "block-actions-button")).toBe(curve(toggle(), "toggle"));
  });

  it("focus-visible 링이 일치한다", () => {
    const focusRing = (file: string, selector: string) => {
      // :focus-visible 셀렉터는 등장(opacity) 그룹 규칙에도 나타난다 — 링 규칙은 box-shadow를
      // 가진 쪽 하나여야 한다.
      const ringBodies = bodies(file, `${selector}:focus-visible`).filter((b) =>
        b.includes("box-shadow"),
      );
      expect(ringBodies.length, `${file}의 ${selector}:focus-visible 링 규칙이 1개가 아님`).toBe(1);
      return decl(ringBodies[0], "box-shadow", `${selector}:focus-visible`);
    };
    expect(focusRing("block-actions.css", ".block-actions-button")).toBe(
      focusRing("code-collapse.css", ".code-collapse-toggle"),
    );
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
