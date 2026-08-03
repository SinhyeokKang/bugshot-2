import type { Page } from "@playwright/test";
import { enterDebugAndPick, expect, pickElement, test } from "./fixtures/extension";

// style-specificity: 캐스케이드 승자 판정을 **실제 Chrome CSSOM 위에서** 고정한다.
// 단위 테스트는 `selectorText`·`el.matches`·`parentRule`을 전부 스텁으로 넣으므로
// "브라우저가 무엇을 돌려주는가"라는 이 판정의 전제 자체를 검증하지 못한다 — 그 공백이
// 이 spec의 존재 이유다(docs/POSTMORTEM.md 2026-07-31 "CSSOM 동작 가정은 e2e로 고정").
//
// 고정하는 전제 3가지:
//  1. 문서순만 보면 지는 규칙이라도 specificity가 높으면 원문이 살아남는다
//  2. Chrome이 hex 이스케이프로 직렬화하는 클래스(`2xl:accent`)의 specificity가 부풀지 않는다
//  3. 조건이 거짓인 `@container` 규칙은 승자를 가로채지 못하고 computed 폴백으로 남는다
//
// 판정축은 CSS 코드 뷰(specified 전량이 직렬화돼 나온다)이고, 값 축은 전부 `rem`이다 —
// 색 리터럴은 CSSOM이 rgb()로 정규화하는 데다 computed가 곧 승자 값이라, 판정이 죽어
// computed로 폴백해도 같은 문자열이 나와 아무것도 구별하지 못한다(첫 작성에서 밟음).
// rem은 computed에서 px로 resolve되므로 "승자 원문"과 "computed 폴백"이 갈린다.
// styleEditorView는 settings 영속이라 afterAll에서 복원한다.
test.describe.serial("style-specificity", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("specificity.html"));

    // 픽스처 전제 확인 — 브라우저가 실제로 고른 승자가 우리 기대와 같아야 이 spec이
    // 무언가를 판정한다. 규칙 순서가 어긋나면 제품은 정상 폴백하고 spec만 공허해진다.
    await expect(fixture.locator("#btn")).toHaveCSS("width", "192px");
    await expect(fixture.locator("#accent")).toHaveCSS("width", "300px");
    await expect(fixture.locator("#cq")).toHaveCSS("width", "240px");

    const tabId = await ext.fixtureTabId("http://127.0.0.1/specificity.html");
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async ({ ext }) => {
    await ext.evalInExt(async () => {
      const key = "bugshot-app-settings";
      const got = await chrome.storage.local.get(key);
      const raw = got[key] as string | undefined;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.state) {
        parsed.state.styleEditorView = "form";
        await chrome.storage.local.set({ [key]: JSON.stringify(parsed) });
      }
    });
    await panel.close();
    await fixture.close();
  });

  const cm = () => panel.getByTestId("style-css-view").locator(".cm-content");

  // CSS 뷰는 요소 전환 시 key remount로 doc을 재파생하므로, 새 요소의 doc이 도착할
  // 때까지 기다려야 stale doc을 읽지 않는다. 게이트는 **단언 대상과 겹치지 않는**
  // marker(min-height)로 잡는다 — 게이트가 곧 단언이면 회귀가 assertion 실패가 아니라
  // timeout으로 나와 원인이 흐려진다. 셀렉터 줄은 못 쓴다: `@medv/finder`가 최단 유니크
  // 셀렉터를 고르므로 `#cq`가 아니라 `p`가 나오는 등 요소마다 형태가 갈린다.
  async function readDoc(marker: string) {
    await expect(cm()).toContainText(marker);
    return (await cm().innerText()).replace(/\s+/g, " ");
  }

  async function repickAndRead(selector: string, marker: string) {
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, selector);
    await expect(panel.getByTestId("repick")).toBeVisible();
    return readDoc(marker);
  }

  test("1. 문서순 뒤의 낮은 specificity 규칙이 승자 원문을 못 덮는다", async () => {
    await enterDebugAndPick(fixture, panel, "#btn");
    await panel.getByTestId("style-view-code").click();
    await expect(panel.getByTestId("style-css-view")).toBeVisible();
    const text = await readDoc("min-height: 11px");

    expect(text).toContain("width: 12rem");
    // 회귀 두 방향: 문서순 last-wins면 패자 값이, 판정 포기면 computed px가 뜬다.
    expect(text).not.toContain("width: 100px");
    expect(text).not.toContain("width: 192px");
  });

  test("2. hex 이스케이프 클래스의 specificity가 부풀지 않는다", async () => {
    const text = await repickAndRead("#accent", "min-height: 12px");

    // 동률이라 문서순 뒤가 이긴다. 이스케이프 종결 공백을 놓치면 앞 규칙이 [0,1,1]로
    // 부풀어 이 판정을 뒤집는다(Tailwind `2xl:`류 클래스가 이 경로를 탄다).
    expect(text).toContain("width: 300px");
    expect(text).not.toContain("10rem");
  });

  test("3. 조건 거짓인 @container 규칙은 승자를 가로채지 못한다", async () => {
    const text = await repickAndRead("#cq", "min-height: 13px");

    // @container 소속은 판정 불가로 남아 computed 폴백을 탄다 — 적용도 안 된 규칙의
    // 원문을 확정 표시하는 것보다 값이 정확한 computed가 낫다.
    expect(text).toContain("width: 240px");
    expect(text).not.toContain("width: 50px");
    expect(text).not.toContain("15rem");

    await panel.getByTestId("style-view-form").click();
    await expect(panel.getByTestId("style-css-view")).toBeHidden();
  });
});
