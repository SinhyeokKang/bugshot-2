import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  expect,
  pickElement,
  test,
} from "./fixtures/extension";

// stable-locator: 요소 selector 생성을 **실제 Chrome 위에서** 고정한다.
//
// 유닛(`src/content/__tests__/element-locator.test.tsx`)은 jsdom + `CSS.escape` 폴리필
// 위에서 돌아, finder가 실제 Chrome CSSOM에서 무엇을 돌려주는지는 검증하지 못한다.
// 게다가 이 저장소 e2e 픽스처는 전부 안정 `#id`를 갖고 있어, 이 기능의 핵심 경로
// (test contract 속성 승격)가 실 브라우저에서 한 번도 실행되지 않았다.
//
// 고정하는 것 4가지:
//  1. 형제가 있어 얕은 경로가 유일하지 않으면 조상 test attribute가 앵커로 쓰인다
//  2. 타깃의 의심스러운 id·해시 class 대신 조상 앵커를 쓴다
//  3. test contract 이름이어도 PII 값은 selector에 실리지 않는다
//  4. 타깃 class를 지워도 selector가 무효화되지 않고, 보강 메시지도 드랍되지 않는다
//
// 판정축은 CSS 코드 뷰(doc 첫 줄이 생성된 selector)다. 게이트는 단언 대상과 겹치지
// 않는 marker(`min-height`)로 잡는다 — 게이트를 selector 줄로 걸면 회귀가 assertion
// 실패가 아니라 timeout으로 나온다(GOTCHAS "CSS 뷰의 셀렉터 줄은 #id가 아닐 수 있다").
// styleEditorView는 settings 영속이라 afterAll에서 복원한다.
test.describe.serial("stable-locator", () => {
  let fixture: Page;
  let panel: Page;

  const CARD = 'article[data-e2e="enrollment-card"] span';
  const PAY = "#deadbeef";
  const PII = 'div[data-testid="user-jane@acme.com"] span';

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("stable-locator.html"));

    // 픽스처 전제 — 얕은 경로가 유일하면 앵커가 나올 자리가 없어 spec이 공허해진다.
    await expect(fixture.locator(".chip")).toHaveCount(2);
    await expect(fixture.locator(".pay")).toHaveCount(2);
    await expect(fixture.locator(".note")).toHaveCount(2);

    const tabId = await ext.fixtureTabId("http://127.0.0.1/stable-locator.html");
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

  test("1. 형제가 있으면 조상 test attribute가 앵커로 쓰인다", async () => {
    await enterDebugAndPick(fixture, panel, CARD);
    await panel.getByTestId("style-view-code").click();
    await expect(panel.getByTestId("style-css-view")).toBeVisible();
    const text = await readDoc("min-height: 11px");

    expect(text).toContain('[data-e2e="enrollment-card"]');
    // 회귀 두 방향: 승격이 죽으면 위치 표현이, 타깃 class 배제가 죽으면 .chip이 뜬다.
    expect(text).not.toContain("nth-of-type");
    expect(text).not.toContain("nth-child");
    expect(text).not.toContain(".chip");
  });

  test("2. 타깃의 의심스러운 id·해시 class 대신 조상 앵커를 쓴다", async () => {
    const text = await repickAndRead(PAY, "min-height: 12px");

    expect(text).toContain('[data-testid="checkout-panel"]');
    // finder 기본은 `#deadbeef`를 penalty 0으로 최우선 채택한다 — 이 단언이 red면
    // 안정성 훅이 stage 0에서 통째로 빠진 것이다.
    expect(text).not.toContain("#deadbeef");
    expect(text).not.toContain("Button_ab12cd34");
  });

  test("3. test contract 이름이어도 PII 값은 selector에 실리지 않는다", async () => {
    const text = await repickAndRead(PII, "min-height: 13px");

    // selector는 이슈 본문·8개 플랫폼 페이로드·저장 초안·LLM endpoint로 나간다.
    expect(text).not.toContain("jane@acme.com");
    expect(text).not.toContain("user-jane");
  });

  test("4. 타깃 class를 지워도 selector가 살아 있고 보강도 드랍되지 않는다", async () => {
    const before = await repickAndRead(CARD, "min-height: 11px");
    expect(before).toContain('[data-e2e="enrollment-card"]');
    expect(before).toContain("color");

    // Class 섹션은 form 뷰에만 있다(코드 뷰는 CSS doc 하나로 대체).
    await panel.getByTestId("style-view-form").click();
    await expect(panel.getByTestId("class-editor")).toBeVisible();
    await panel.getByTestId("class-editor").fill("");
    await expect(fixture.locator(CARD)).toHaveAttribute("class", "");

    await panel.getByTestId("style-view-code").click();
    await expect(panel.getByTestId("style-css-view")).toBeVisible();

    // class가 빠지면 `.chip { color }`가 더는 적용되지 않는다. 그 사실이 패널에
    // 반영되려면 picker.selectionUpdated가 살아야 하는데, 그 메시지의 selector가
    // picker.selected와 갈리면 sameElementKey stale 가드에 걸려 **무음으로 드랍**된다.
    await expect(cm()).not.toContainText("color:");

    // selector 자체는 그대로여야 rebind·편집 적용·캡처가 같은 요소를 계속 집는다.
    // doc 첫 줄이 selector라 startsWith가 곧 "selector 불변" 단언이다.
    const after = (await cm().innerText()).replace(/\s+/g, " ");
    expect(after.startsWith('[data-e2e="enrollment-card"] span')).toBe(true);
    expect(after).not.toContain("nth-of-type");

    await panel.getByTestId("style-view-form").click();
    await expect(panel.getByTestId("style-css-view")).toBeHidden();
  });
});
