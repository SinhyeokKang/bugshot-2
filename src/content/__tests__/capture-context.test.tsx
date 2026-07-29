import { afterEach, describe, expect, it } from "vitest";

import { findContextAncestor, resolveContextRect } from "../capture-context";

afterEach(() => {
  document.body.replaceChildren();
});

function mount(html: string): void {
  document.body.innerHTML = html;
}

function $(selector: string): Element {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`fixture missing: ${selector}`);
  return el;
}

/* ------------------------------------------------------------------ */
/*  findContextAncestor — DOM 탐색                                      */
/*  jsdom은 getBoundingClientRect()가 항상 0이지만 closest·contains는     */
/*  정상 동작한다. 이 함수는 computed style을 읽지 않으므로 스타일 불필요.  */
/* ------------------------------------------------------------------ */

describe("findContextAncestor", () => {
  it("role=dialog 안 버튼이면 다이얼로그를 반환한다", () => {
    mount(`
      <div role="dialog" id="dlg">
        <div><button id="target">삭제</button></div>
      </div>
    `);

    expect(findContextAncestor($("#target"))).toBe($("#dlg"));
  });

  it("테이블 셀 안 요소면 tr을 반환한다", () => {
    mount(`
      <table><tbody>
        <tr id="row"><td><span id="target">badge</span></td></tr>
      </tbody></table>
    `);

    expect(findContextAncestor($("#target"))).toBe($("#row"));
  });

  it("모달 안 테이블 셀이면 다이얼로그가 아니라 tr을 반환한다 — 최근접 우선", () => {
    mount(`
      <div role="dialog" id="dlg">
        <table><tbody>
          <tr id="row"><td><span id="target">badge</span></td></tr>
        </tbody></table>
      </div>
    `);

    expect(findContextAncestor($("#target"))).toBe($("#row"));
  });

  it("li 안 버튼이면 li를 반환한다", () => {
    mount(`
      <ul><li id="item"><button id="target">수정</button></li></ul>
    `);

    expect(findContextAncestor($("#target"))).toBe($("#item"));
  });

  it("role=tabpanel 안 요소면 tabpanel을 반환한다", () => {
    mount(`
      <div role="tabpanel" id="panel"><span id="target">내용</span></div>
    `);

    expect(findContextAncestor($("#target"))).toBe($("#panel"));
  });

  it("form 안 input이면 null — 민감정보 범위 확대 방지로 후보에서 제외", () => {
    mount(`
      <form id="f"><input id="target" /></form>
    `);

    expect(findContextAncestor($("#target"))).toBeNull();
  });

  it("시맨틱 없는 div 체인이면 null", () => {
    mount(`
      <div><div><div><button id="target">전송</button></div></div></div>
    `);

    expect(findContextAncestor($("#target"))).toBeNull();
  });

  it("손수 만든 백드롭(div 부모 + 안쪽 div)이면 null — 셀렉터 목록에 없다", () => {
    mount(`
      <div class="backdrop">
        <div class="modal"><button id="target">확인</button></div>
      </div>
    `);

    expect(findContextAncestor($("#target"))).toBeNull();
  });

  it("요소 자신이 li이고 상위에 후보가 없으면 null — 자신은 제외", () => {
    mount(`
      <ul><li id="target">항목</li></ul>
    `);

    expect(findContextAncestor($("#target"))).toBeNull();
  });

  it("section·nav·aside·header·footer·role=group은 후보가 아니다", () => {
    mount(`
      <section><nav><aside><header><footer>
        <div role="group"><button id="target">액션</button></div>
      </footer></header></aside></nav></section>
    `);

    expect(findContextAncestor($("#target"))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  resolveContextRect — after 재검증                                   */
/*  DOM 조회·rect 측정은 호출부(picker.ts)가 하고 판정만 여기서 한다.      */
/* ------------------------------------------------------------------ */

describe("resolveContextRect", () => {
  const VIEWPORT = { width: 1000, height: 800 };
  const ELEMENT_RECT = { x: 20, y: 20, width: 100, height: 50 };
  // 600×400 = 240,000 = 뷰포트의 30% — 게이트 통과 크기.
  const OK_CONTEXT_RECT = { x: 0, y: 0, width: 600, height: 400 };

  function fixture() {
    mount(`
      <div role="dialog" id="dlg"><button id="target">삭제</button></div>
      <div role="dialog" id="other"><button id="stray">취소</button></div>
    `);
    return { found: $("#dlg"), target: $("#target"), other: $("#other") };
  }

  it("found가 target을 포함하고 게이트를 통과하면 조상 rect와 저장 selector를 쓴다", () => {
    const { found, target } = fixture();

    expect(
      resolveContextRect({
        saved: '[role="dialog"]#dlg',
        found,
        target,
        contextRect: OK_CONTEXT_RECT,
        elementRect: ELEMENT_RECT,
        viewport: VIEWPORT,
      }),
    ).toEqual({
      rect: OK_CONTEXT_RECT,
      contextSelector: '[role="dialog"]#dlg',
    });
  });

  it("found가 null이면(selector 소실) 요소 rect로 폴백한다", () => {
    const { target } = fixture();

    expect(
      resolveContextRect({
        saved: '[role="dialog"]#gone',
        found: null,
        target,
        contextRect: null,
        elementRect: ELEMENT_RECT,
        viewport: VIEWPORT,
      }),
    ).toEqual({ rect: ELEMENT_RECT, contextSelector: null });
  });

  it("found가 target을 포함하지 않으면(다른 형제에 재결합) 요소 rect로 폴백한다", () => {
    const { target, other } = fixture();

    expect(
      resolveContextRect({
        saved: '[role="dialog"]#dlg',
        found: other,
        target,
        contextRect: OK_CONTEXT_RECT,
        elementRect: ELEMENT_RECT,
        viewport: VIEWPORT,
      }),
    ).toEqual({ rect: ELEMENT_RECT, contextSelector: null });
  });

  it("재측정 rect가 면적 40%를 넘으면 요소 rect로 폴백한다", () => {
    const { found, target } = fixture();

    expect(
      resolveContextRect({
        saved: '[role="dialog"]#dlg',
        found,
        target,
        // 800×500 = 400,000 = 50%
        contextRect: { x: 0, y: 0, width: 800, height: 500 },
        elementRect: ELEMENT_RECT,
        viewport: VIEWPORT,
      }),
    ).toEqual({ rect: ELEMENT_RECT, contextSelector: null });
  });

  it("재측정 rect가 뷰포트를 벗어나면 요소 rect로 폴백한다", () => {
    const { found, target } = fixture();

    expect(
      resolveContextRect({
        saved: '[role="dialog"]#dlg',
        found,
        target,
        // bottom = 600 + 400 = 1000 > 800
        contextRect: { x: 0, y: 600, width: 600, height: 400 },
        elementRect: ELEMENT_RECT,
        viewport: VIEWPORT,
      }),
    ).toEqual({ rect: ELEMENT_RECT, contextSelector: null });
  });

  it("target이 0×0(display:none)이어도 DOM 포함 + 게이트 통과면 조상 rect를 쓴다", () => {
    const { found, target } = fixture();

    expect(
      resolveContextRect({
        saved: '[role="dialog"]#dlg',
        found,
        target,
        contextRect: OK_CONTEXT_RECT,
        elementRect: { x: 0, y: 0, width: 0, height: 0 },
        viewport: VIEWPORT,
      }),
    ).toEqual({
      rect: OK_CONTEXT_RECT,
      contextSelector: '[role="dialog"]#dlg',
    });
  });
});
