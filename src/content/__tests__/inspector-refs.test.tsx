import { describe, it, expect, vi, beforeEach } from "vitest";

// 규칙 매칭은 css-source-cache 인덱스가 담당한다 — 여기선 jsdom CSSOM으로 만든 진짜
// CSSStyleRule을 셀렉터로 골라 돌려준다(인덱스 자체는 이 파일의 검증 대상이 아니다).
const matchRules = vi.hoisted(() =>
  vi.fn((_el: Element) => [] as unknown[]),
);
vi.mock("../css-source-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../css-source-cache")>();
  return {
    // splitSelectorList 등 순수 헬퍼는 실제 구현 유지 — matchedSpecificity가 쓴다.
    ...actual,
    getMatchingRules: (el: Element) => matchRules(el),
    getRawDeclarationsFor: () => null,
    getCrossOriginCustomProps: () => ({}),
    getMatchingCrossOriginRules: () => [],
    getMatchingCrossOriginCustomPropRules: () => [],
    flattenSheets: (sheets: unknown[]) => sheets,
  };
});

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

  it("조상 스코프가 바뀌면 다음 조회에 바로 반영된다 (편집·테마 토글)", () => {
    // 스타일 편집은 클래스·인라인을 라이브로 바꾸지만 CSS 캐시 세대는 그대로다 —
    // 조상 custom property memo가 남으면 편집 후 토큰 이름이 옛 스코프로 굳는다.
    const [themeRule] = sheet("[data-theme] { --_text: var(--color-brand); }");
    const [elRule] = sheet(
      ".btn { color: var(--_text); font-size: 12px; font-weight: 400; }",
    );
    const host = document.createElement("div");
    const el = document.createElement("button");
    el.className = "btn";
    host.appendChild(el);
    document.body.appendChild(host);
    matchRules.mockImplementation((target: Element) =>
      target === el ? [elRule] : target === host && target.matches("[data-theme]") ? [themeRule] : [],
    );
    const computed = {
      getPropertyValue: (name: string) =>
        name === "--_text" || name === "--color-brand" ? "#fff" : "",
    };

    // 아직 테마 속성이 없어 별칭 원문을 못 본다 → memo에 "없음"이 박힌다.
    expect(collectInspectorSpecRefs(el, computed).color).toBe("#fff");

    host.setAttribute("data-theme", "dark");

    expect(collectInspectorSpecRefs(el, computed).color).toBe("var(--color-brand)");
  });

  it("한 스코프의 두 규칙이 같은 별칭을 다르게 정의하면 이름을 포기한다", () => {
    // 어느 쪽이 이겼는지 모른 채 first-write 원문을 보존하면 패자 토큰 이름을 노출한다.
    const rules = sheet(
      "[data-theme] { --_text: var(--token-a); }" +
        "[data-theme] { --_text: var(--token-b); }",
    );
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
      target === el ? [elRule] : target === host ? rules : [],
    );

    const refs = collectInspectorSpecRefs(el, {
      getPropertyValue: (name) => (name.startsWith("--") ? "#fff" : ""),
    });

    expect(refs.color).toBe("#fff");
  });

  it("가까운 스코프가 먼 스코프를 가리는 건 충돌이 아니다 (이름 보존)", () => {
    // :root와 [data-theme]가 같은 별칭을 정의하는 건 정상 섀도잉 — 가까운 쪽이 이긴다.
    const [rootRule] = sheet(":root { --_text: var(--token-far); }");
    const [themeRule] = sheet("[data-theme] { --_text: var(--token-near); }");
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
      target === el
        ? [elRule]
        : target === host
          ? [themeRule]
          : target === document.documentElement
            ? [rootRule]
            : [],
    );

    const refs = collectInspectorSpecRefs(el, {
      getPropertyValue: (name) => (name.startsWith("--") ? "#fff" : ""),
    });

    expect(refs.color).toBe("var(--token-near)");
  });

  it("상속 prop을 찾아 조상을 올라도 요소 자신의 별칭이 이긴다 (섀도잉 오인 금지)", () => {
    // 이 경로는 조상 순회가 customProps를 공유한다 — 스코프 간 재정의를 충돌로 세면
    // 멀쩡한 토큰 이름이 리터럴로 무너진다.
    const [elRule] = sheet(".btn { --_text: var(--token-own); color: var(--_text); }");
    const [hostRule] = sheet(".host { --_text: var(--token-far); font-size: 12px; }");
    const host = document.createElement("div");
    host.className = "host";
    const el = document.createElement("button");
    el.className = "btn";
    host.appendChild(el);
    document.body.appendChild(host);
    matchRules.mockImplementation((target: Element) =>
      target === el ? [elRule] : target === host ? [hostRule] : [],
    );

    const refs = collectInspectorSpecRefs(el, {
      getPropertyValue: (name) => (name.startsWith("--") ? "#fff" : ""),
    });

    expect(refs.color).toBe("var(--token-own)");
  });

  it("var()를 안 쓰는 요소는 조상 체인을 훑지 않는다", () => {
    const [elRule] = sheet(".btn { color: #fff; font-size: 12px; font-weight: 400; }");
    const host = document.createElement("div");
    const el = document.createElement("button");
    el.className = "btn";
    host.appendChild(el);
    document.body.appendChild(host);
    matchRules.mockImplementation((target: Element) => (target === el ? [elRule] : []));

    collectInspectorSpecRefs(el, { getPropertyValue: () => "" });

    // 요소 자신 1회뿐 — custom property를 해석할 일이 없으면 순회 자체가 낭비다.
    expect(matchRules.mock.calls.map(([t]) => t)).toEqual([el]);
  });

  it("shadow·detached라 부모 체인이 끊겨도 :root 토큰은 본다", () => {
    const [rootRule] = sheet(":root { --_text: var(--color-brand); }");
    const [elRule] = sheet(
      ".btn { color: var(--_text); font-size: 12px; font-weight: 400; }",
    );
    // 문서에 붙이지 않는다 — parentElement 체인이 documentElement에 닿지 않는다.
    const el = document.createElement("button");
    el.className = "btn";
    matchRules.mockImplementation((target: Element) =>
      target === el ? [elRule] : target === document.documentElement ? [rootRule] : [],
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
