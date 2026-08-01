import { describe, it, expect, vi, beforeEach } from "vitest";

// 규칙 매칭은 css-source-cache 인덱스가 담당한다 — 여기선 jsdom CSSOM으로 만든 진짜
// CSSStyleRule을 셀렉터로 골라 돌려준다(인덱스 자체는 이 파일의 검증 대상이 아니다).
const matchRules = vi.hoisted(() =>
  vi.fn((_el: Element) => [] as unknown[]),
);
// docEl 기여분 memo는 캐시 세대로 무효화된다 — 케이스마다 세대를 올려 격리한다.
const epoch = vi.hoisted(() => {
  let n = 0;
  const fn = () => n;
  fn.bump = () => { n += 1; };
  return fn;
});
vi.mock("../css-source-cache", () => ({
  getMatchingRules: (el: Element) => matchRules(el),
  getRawDeclarationsFor: () => null,
  getCrossOriginCustomProps: () => ({}),
  getMatchingCrossOriginRules: () => [],
  flattenSheets: (sheets: unknown[]) => sheets,
  getCacheEpoch: () => epoch(),
}));

import { collectInspectorSpecRefs } from "../css-resolve";

function sheet(css: string): CSSStyleRule[] {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  const rules = style.sheet!.cssRules;
  return Array.from(rules) as CSSStyleRule[];
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  matchRules.mockReset();
  epoch.bump();
});

// 툴팁(collectInspectorSpecRefs)과 편집/CSS 뷰는 수집기가 갈라져 있어, 한쪽만 :root 보강·
// hydrate를 타면 같은 요소에서 다른 토큰 이름이 뜬다(POSTMORTEM 2026-08-01).
describe("collectInspectorSpecRefs — 편집 경로와 같은 전처리", () => {
  it(":root에 정의된 private alias를 펼쳐 public 토큰 이름을 돌려준다", () => {
    const [rootRule] = sheet(":root { --_text: var(--color-brand); }");
    // 상속 prop(color·font-size·font-weight)이 전부 요소에 선언되면 조상 순회가 아예 돌지
    // 않는다 — :root 보강이 없으면 그 스코프의 alias 원문을 못 본다.
    const [elRule] = sheet(
      ".btn { color: var(--_text); font-size: 12px; font-weight: 400; }",
    );
    const el = document.createElement("button");
    el.className = "btn";
    document.body.appendChild(el);

    // el은 자기 규칙만, documentElement는 :root 규칙만 매칭된다.
    matchRules.mockImplementation((target: Element) =>
      target === el ? [elRule] : target === document.documentElement ? [rootRule] : [],
    );

    const refs = collectInspectorSpecRefs(el, {
      getPropertyValue: (name) =>
        name === "--_text" || name === "--color-brand" ? "#fff" : "",
    });

    expect(refs.color).toBe("var(--color-brand)");
  });

  it("body·테마 스코프의 별칭도 본다 (상속 prop이 다 차 조상 순회가 멈춰도)", () => {
    // 조상 순회는 상속 prop을 채우는 게 목적이라 다 차면 멈춘다 — custom property 수집이
    // 거기 얹혀 있으면 body·[data-theme]에 별칭을 둔 사이트에서 원문을 통째로 놓친다.
    const [themeRule] = sheet("[data-theme] { --_text: var(--color-brand); }");
    const [elRule] = sheet(
      ".btn { color: var(--_text); font-size: 12px; font-weight: 400; }",
    );
    const host = document.createElement("div");
    host.setAttribute("data-theme", "dark");
    const el = document.createElement("button");
    el.className = "btn";
    host.appendChild(el);
    document.body.appendChild(host);

    matchRules.mockImplementation((target: Element) =>
      target === el ? [elRule] : target === host ? [themeRule] : [],
    );

    const refs = collectInspectorSpecRefs(el, {
      getPropertyValue: (name) =>
        name === "--_text" || name === "--color-brand" ? "#fff" : "",
    });

    expect(refs.color).toBe("var(--color-brand)");
  });

  it("주입한 computed로 hydrate한다 (편집 경로와 같은 승자 판정)", () => {
    const [elRule] = sheet(".btn { color: var(--_text); }");
    const el = document.createElement("button");
    el.className = "btn";
    document.body.appendChild(el);
    matchRules.mockImplementation((target: Element) => (target === el ? [elRule] : []));

    const getPropertyValue = vi.fn((name: string) =>
      name === "--_text" ? "#0f0" : "",
    );
    const refs = collectInspectorSpecRefs(el, { getPropertyValue });

    expect(getPropertyValue).toHaveBeenCalledWith("--_text");
    // 어느 스코프에도 원문이 없으면 computed 승자를 쓴다(= 편집 탭과 같은 결론).
    expect(refs.color).toBe("#0f0");
  });
});
