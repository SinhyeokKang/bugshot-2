import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildStableSelector,
  pathSelector,
  resetStableSelectorCache,
  reuseStableSelector,
} from "../element-locator";

afterEach(() => {
  document.body.replaceChildren();
  resetStableSelectorCache();
});

function mount(html: string): void {
  document.body.innerHTML = html;
}

function $(selector: string): Element {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`fixture missing: ${selector}`);
  return el;
}

/** selector가 정확히 그 요소 하나만 가리키는지 — 모든 케이스의 공통 계약. */
function expectResolvesTo(selector: string, el: Element): void {
  const hits = document.querySelectorAll(selector);
  expect(hits.length).toBe(1);
  expect(hits[0]).toBe(el);
}

/* ------------------------------------------------------------------ */
/*  앵커 우선                                                           */
/*                                                                     */
/*  finder는 "가장 싼 유일 후보"를 반환하므로 앵커는 얕은 경로가 유일하지     */
/*  않을 때만 나타난다. 아래 픽스처는 전부 그 조건을 만든다 — 형제 카드가     */
/*  있어야 test attribute가 실제로 일을 한다.                             */
/* ------------------------------------------------------------------ */

describe("buildStableSelector — 안정 앵커", () => {
  it("형제 카드가 있으면 data-e2e 앵커가 위치+타깃 class 후보를 이긴다", () => {
    mount(`
      <article data-e2e="enrollment-card"><p><span class="chip">2026</span></p></article>
      <article><p><span class="chip">2027</span></p></article>
    `);
    const target = $("article[data-e2e] span");

    const selector = buildStableSelector(target);

    expect(selector).toBe('[data-e2e="enrollment-card"] span');
    expectResolvesTo(selector, target);
  });

  it("타깃의 동적 ID와 해시 class 대신 조상 data-testid를 쓴다", () => {
    mount(`
      <section data-testid="checkout-panel">
        <div><button id="btn-550e8400e29b41d4" class="Button_ab12cd34">Pay</button></div>
      </section>
      <section><div><button class="Button_ab12cd34">Other</button></div></section>
    `);
    const target = $("#btn-550e8400e29b41d4");

    const selector = buildStableSelector(target);

    expect(selector).toBe('[data-testid="checkout-panel"] button');
    expectResolvesTo(selector, target);
  });

  it("선택 요소가 가진 class는 안정 후보에 쓰지 않는다", () => {
    mount(`
      <article data-e2e="enrollment-card"><p><span class="chip">2026</span></p></article>
      <article><p><span class="chip">2027</span></p></article>
    `);
    const target = $("article[data-e2e] span");

    expect(buildStableSelector(target)).not.toContain(".chip");
  });

  it("반복 test attribute만으로 유일해지지 않으면 위치 표현으로 target 하나를 집는다", () => {
    mount(`
      <article data-e2e="enrollment-card"><p><span class="chip">2026</span></p></article>
      <article data-e2e="enrollment-card"><p><span class="chip">2027</span></p></article>
    `);
    const target = $("article:nth-of-type(1) span");

    const selector = buildStableSelector(target);

    expect(selector).toContain(":nth-");
    expectResolvesTo(selector, target);
  });

  it("조상이 타깃과 같은 이름의 class를 써도 함께 배제된다", () => {
    // finder 훅에 element 인자가 없어 소유자를 구분할 수 없다. 이름 기준 전역
    // 거부의 손실을 계약으로 고정한다 — 여기선 조상의 .row도 못 쓰므로
    // stable 단계가 data-e2e 앵커로 간다.
    mount(`
      <div class="row" data-e2e="first"><span class="row">a</span></div>
      <div class="row"><span class="row">b</span></div>
    `);
    const target = $("[data-e2e] span");

    const selector = buildStableSelector(target);

    expect(selector).not.toContain(".row");
    expect(selector).toContain('[data-e2e="first"]');
  });

  it("타깃 class가 유일한 구분자면 compat 후보를 채택해 회귀를 만들지 않는다", () => {
    mount(`
      <ul>
        <li><span class="badge-hot">a</span></li>
        <li><span class="badge-cold">b</span></li>
      </ul>
    `);
    const target = $(".badge-hot");

    // stable 단계는 타깃 class를 못 써 위치 후보(li:nth-child(1) > span)를 낸다.
    // 위치 유무가 첫 비교 키라 위치 없는 compat 후보가 이겨야 한다.
    expect(buildStableSelector(target)).toBe(".badge-hot");
  });
});

/* ------------------------------------------------------------------ */
/*  유일성·escaping·방어                                                */
/* ------------------------------------------------------------------ */

describe("buildStableSelector — 계약", () => {
  it("특수문자 class/ID도 escape 후 그 요소만 가리킨다", () => {
    // 주의: jsdom 폴리필 기준이다. Chrome CSSOM 직렬화 회귀는 e2e·수동이 그물.
    mount(`
      <div><b class="2xl:mt-4">x</b></div>
      <div><b class="2xl:mt-4">y</b></div>
    `);
    const target = document.querySelectorAll("b")[0];

    expectResolvesTo(buildStableSelector(target), target);
  });

  it("html 요소는 html을 반환한다", () => {
    expect(buildStableSelector(document.documentElement)).toBe("html");
  });

  it("body 직계 자식도 그 요소만 가리킨다", () => {
    mount(`<main id="root">x</main><aside>y</aside>`);
    const target = $("#root");

    expectResolvesTo(buildStableSelector(target), target);
  });

  it("SVG 요소도 처리한다", () => {
    mount(`
      <svg data-testid="chart"><circle r="1"></circle></svg>
      <svg><circle r="2"></circle></svg>
    `);
    const target = $("[data-testid='chart'] circle");

    expectResolvesTo(buildStableSelector(target), target);
  });

  it("연결이 끊긴 요소는 유일성을 가장하지 않고 던진다", () => {
    const orphan = document.createElement("div");

    expect(() => buildStableSelector(orphan)).toThrow();
  });
});

/* ------------------------------------------------------------------ */
/*  2단계 실행 · 예산 · fallback                                         */
/*  finder를 주입 seam으로 두고 mock으로 호출 계약을 고정한다.             */
/* ------------------------------------------------------------------ */

describe("buildStableSelector — 단계와 예산", () => {
  function fixture(): Element {
    mount(`<div><b class="x">a</b></div>`);
    return $("b");
  }

  it("stable → compat 순으로 2회 호출하고 path check를 1000씩 나눈다", () => {
    const el = fixture();
    const finder = vi.fn().mockReturnValue("b");

    buildStableSelector(el, { finder, now: () => 0 });

    expect(finder).toHaveBeenCalledTimes(2);
    expect(finder.mock.calls[0][1].maxNumberOfPathChecks).toBe(1000);
    expect(finder.mock.calls[1][1].maxNumberOfPathChecks).toBe(1000);
  });

  it("각 단계 timeoutMs는 공용 500ms deadline의 남은 값이다", () => {
    const el = fixture();
    const finder = vi.fn().mockReturnValue("b");
    const clock = [0, 0, 120, 120];
    let i = 0;

    buildStableSelector(el, { finder, now: () => clock[i++] ?? 120 });

    expect(finder.mock.calls[0][1].timeoutMs).toBe(500);
    expect(finder.mock.calls[1][1].timeoutMs).toBe(380);
  });

  it("stable 단계가 throw해도 compat 단계를 실행한다", () => {
    const el = fixture();
    const finder = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("Timeout: Can't find a unique selector after 500ms");
      })
      .mockReturnValueOnce("b");

    expect(buildStableSelector(el, { finder, now: () => 0 })).toBe("b");
    expect(finder).toHaveBeenCalledTimes(2);
  });

  it("두 단계가 모두 throw하면 path fallback을 반환한다", () => {
    const el = fixture();
    const finder = vi.fn().mockImplementation(() => {
      throw new Error("Selector was not found.");
    });

    expect(buildStableSelector(el, { finder, now: () => 0 })).toBe(
      pathSelector(el),
    );
  });

  it("예산이 끊기면 후속 단계를 호출하지 않고 path fallback으로 수렴한다", () => {
    const el = fixture();
    const finder = vi.fn().mockReturnValue("b");
    const clock = [0, 0, 900];
    let i = 0;

    const selector = buildStableSelector(el, {
      finder,
      now: () => clock[i++] ?? 900,
    });

    expect(finder).toHaveBeenCalledTimes(1);
    // 부분 결과("b")를 채택하지 않는다 — 예산 소진 여부로 결과가 갈리면
    // selector가 sameElementKey 동등성 키라 버퍼가 중복된다.
    expect(selector).toBe(pathSelector(el));
  });

  it("보강 호출은 직전 선택과 같은 요소면 finder를 다시 돌리지 않는다", () => {
    const el = fixture();
    const finder = vi.fn().mockReturnValue("b");

    const selected = buildStableSelector(el, { finder, now: () => 0 });
    const enriched = reuseStableSelector(el, { finder, now: () => 0 });

    expect(enriched).toBe(selected);
    expect(finder).toHaveBeenCalledTimes(2); // 선택 시점의 2단계뿐
  });

  it("보강 호출이 다른 요소면 그 요소로 새로 계산한다", () => {
    mount(`<div><b class="x">a</b><i class="y">b</i></div>`);
    const finder = vi.fn().mockReturnValue("b");

    buildStableSelector($("b"), { finder, now: () => 0 });
    reuseStableSelector($("i"), { finder, now: () => 0 });

    expect(finder).toHaveBeenCalledTimes(4);
  });

  it("재선택은 항상 다시 계산한다 — DOM이 바뀌면 캐시가 엉뚱한 요소를 가리킨다", () => {
    mount(`
      <ul><li><span>a</span></li><li><span>b</span></li></ul>
    `);
    const target = document.querySelectorAll("span")[1];
    const before = buildStableSelector(target);

    // 리스트가 재배치돼 같은 노드가 1번 자리로 이동한다(React 노드 재사용).
    const list = $("ul");
    list.insertBefore(target.parentElement!, list.firstElementChild);

    const after = buildStableSelector(target);

    expect(after).not.toBe(before);
    expectResolvesTo(after, target);
  });
});

/* ------------------------------------------------------------------ */
/*  pathSelector — dom-describe에서 이관                                 */
/* ------------------------------------------------------------------ */

describe("pathSelector", () => {
  it("documentElement까지 nth-of-type 체인을 만든다", () => {
    mount(`<div><p>a</p><p>b</p></div>`);
    const target = document.querySelectorAll("p")[1];

    const selector = pathSelector(target);

    expect(selector).toBe("body > div > p:nth-of-type(2)");
    expectResolvesTo(selector, target);
  });

  it("형제 중 유일한 태그면 nth-of-type을 붙이지 않는다", () => {
    mount(`<section><h1>t</h1></section>`);

    expect(pathSelector($("h1"))).toBe("body > section > h1");
  });
});
