import { afterEach, describe, expect, it } from "vitest";

import type { TreeNode } from "@/types/picker";

import { ANNOTATION_HOST_ID } from "../annotation";
import { buildInitialTree, buildSelector } from "../dom-describe";
import { buildStableSelector, resetStableSelectorCache } from "../element-locator";
import { HOST_ID } from "../overlay";

afterEach(() => {
  document.body.replaceChildren();
  resetStableSelectorCache();
});

function mount(html: string): void {
  document.body.innerHTML = html;
}

function findNode(node: TreeNode, selector: string): TreeNode | null {
  if (node.selector === selector) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, selector);
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  DOM Tree ↔ 선택 요소 대응                                           */
/*                                                                     */
/*  DomTreeDialog는 현재 노드 하이라이트를 selector 문자열 등가 비교로     */
/*  판정한다. 트리 노드와 ancestorPath가 같은 빌더(buildSelector)를        */
/*  쓴다는 것이 그 비교의 전제이고, 스토어의 selection.selector는 이제      */
/*  다른 빌더 산출이라 쓸 수 없다.                                       */
/* ------------------------------------------------------------------ */

describe("buildInitialTree — ancestorPath 계약", () => {
  it("ancestorPath의 마지막 항목이 선택 요소 트리 노드의 selector와 같다", () => {
    mount(`
      <article data-e2e="card"><p><span class="chip">a</span></p></article>
      <article><p><span class="chip">b</span></p></article>
    `);
    const target = document.querySelector("article[data-e2e] span")!;

    const { tree, ancestorPath } = buildInitialTree(target);
    const current = ancestorPath.at(-1);

    expect(current).toBe(buildSelector(target));
    expect(findNode(tree, current!)).not.toBeNull();
  });

  it("그 selector는 stable 빌더 산출과 다를 수 있다", () => {
    // 이게 성립하니까 하이라이트 판정을 스토어에서 가져오면 안 된다.
    // 갈리는 조건이 곧 앵커가 채택되는 조건이라, 기능이 일할 때만 하이라이트가 죽는다.
    mount(`
      <article data-e2e="card"><p><span class="chip">a</span></p></article>
      <article><p><span class="chip">b</span></p></article>
    `);
    const target = document.querySelector("article[data-e2e] span")!;

    const { ancestorPath } = buildInitialTree(target);

    expect(buildStableSelector(target)).not.toBe(ancestorPath.at(-1));
  });

  it("선택 요소가 없으면 ancestorPath가 비어 하이라이트 대상도 없다", () => {
    mount(`<main>x</main>`);

    expect(buildInitialTree(null).ancestorPath).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  자체 UI overlay host 제외                                            */
/*                                                                     */
/*  isRenderable은 private이라 buildInitialTree의 children 필터로         */
/*  간접 검증한다. 어노테이션 host를 추가할 때 picker host 제외가          */
/*  교체되면(=OR가 아니라 대체) picker overlay가 트리에 노출된다.          */
/* ------------------------------------------------------------------ */

describe("buildInitialTree — 자체 overlay host 제외", () => {
  // body를 펼치려면 선택 요소가 그 안에 있어야 한다(ancestorSet에 든 노드만 expand된다).
  function bodyChildIds(html: string): (string | null)[] {
    mount(`${html}<main id="app"><span id="t">x</span></main>`);
    const { tree } = buildInitialTree(document.getElementById("t"));
    const body = tree.children?.find((c) => c.tag === "body");
    return body?.children?.map((c) => c.id) ?? [];
  }

  it("어노테이션 overlay host를 트리에서 제외한다", () => {
    expect(bodyChildIds(`<div id="${ANNOTATION_HOST_ID}"></div>`)).not.toContain(
      ANNOTATION_HOST_ID,
    );
  });

  it("picker overlay host 제외가 유지된다 (교체가 아니라 얹기)", () => {
    expect(bodyChildIds(`<div id="${HOST_ID}"></div>`)).not.toContain(HOST_ID);
  });

  it("두 host가 아닌 일반 요소는 그대로 포함한다", () => {
    expect(bodyChildIds(`<div id="${ANNOTATION_HOST_ID}"></div>`)).toContain("app");
  });
});
