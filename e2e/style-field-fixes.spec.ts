import type { Page } from "@playwright/test";
import {
  closeAllPopovers,
  enterDebugAndPick,
  expect,
  pickElement,
  selectStyleValue,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// style-panel-field-fixes feature의 e2e 시나리오:
// D) length 라이브 입력이 px로 정규화되어 즉시 적용 / C) SelectProp 빈 옵션 리셋(__empty__ 미기록)
// E) linked 상태가 요소 재선택에 따라 재판정(한 면 입력이 4면을 덮지 않음) + 링크 토글 어포던스 유지

test.describe.serial("style-field-fixes: live normalize + select reset", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  const propRow = (label: string) =>
    panel.locator("section").getByText(label, { exact: true }).locator("..");
  const trigger = () => panel.getByTestId("changes-trigger");
  const dialog = () => panel.getByTestId("changes-dialog");
  const currentCard = () =>
    panel.locator('[data-testid="changes-card"][data-source="current"]');

  test("D: length 다자릿수 라이브 입력이 px로 정규화 + 입력란 raw 유지", async () => {
    await enterDebugAndPick(fixture, panel, "#title");
    const buttons = propRow("padding").locator("button");
    const toggle = buttons.last();
    if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
    await buttons.nth(0).click(); // top
    const input = panel.locator("[cmdk-input]");
    await input.click();
    await input.pressSequentially("24"); // 단위 없는 다자릿수를 한 글자씩
    // 방향 A: 입력란은 raw "24" 유지(px 리싱크 clobber 없음). 버그면 "2px4"가 된다.
    await expect(input).toHaveValue("24");
    // 라이브: 팝오버를 닫기 전에 24px로 정규화돼 적용된다 (기존엔 무효 "24"라 미적용)
    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "24px");
    await closeAllPopovers(panel);
    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "24px");
  });

  test("C: SelectProp 빈 옵션 선택이 prop을 리셋(__empty__ 미기록)", async () => {
    // #title 버퍼로 두고 #el2 재선택
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#el2");
    await expect(panel.getByTestId("repick")).toBeVisible();

    await typeStyleValue(panel, "color", "#ff0000");
    await selectStyleValue(panel, "display", "inline-block");
    await expect(fixture.locator("#el2")).toHaveCSS("display", "inline-block");

    // 빈 옵션 라벨은 원본 display(block) → "(block)". 선택 시 inline display 제거(리셋)
    await selectStyleValue(panel, "display", "(block)");
    await expect(fixture.locator("#el2")).toHaveCSS("display", "block");

    await trigger().click();
    await expect(dialog()).toBeVisible();
    // 리셋되어 display 변경 행이 사라짐(버그면 __empty__ 행이 남음)
    await expect(currentCard().locator('[data-prop="color"]')).toHaveCount(1);
    await expect(currentCard().locator('[data-prop="display"]')).toHaveCount(0);
    await expect(dialog()).not.toContainText("__empty__");
    await panel.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  });
});

test.describe.serial("style-field-fixes: linked repick", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  const paddingButtons = () =>
    panel
      .locator("section")
      .getByText("padding", { exact: true })
      .locator("..")
      .locator("button");

  test("E1: 4면 동일→상이 요소 repick 후 한 면 입력이 4면을 덮지 않음", async () => {
    // A: #el1 (swatch padding 12px 4면 동일) → linked 기본 true로 마운트
    await enterDebugAndPick(fixture, panel, "#el1");
    // B: #quad (padding 4/8/12/16 상이)로 재선택 → selKey 변경으로 linked 재판정(false)
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await fixture.locator("#quad").scrollIntoViewIfNeeded();
    await pickElement(fixture, panel, "#quad");
    await expect(panel.getByTestId("repick")).toBeVisible();

    // 토글을 건드리지 않고 top만 입력 — auto-derive된 linked 상태를 검증
    await paddingButtons().nth(0).click();
    await panel.locator("[cmdk-input]").fill("99px");
    await closeAllPopovers(panel);

    // top만 바뀌고 나머지 3면은 원본 유지(버그면 4면 전부 99px로 덮임)
    await expect(fixture.locator("#quad")).toHaveCSS("padding-top", "99px");
    await expect(fixture.locator("#quad")).toHaveCSS("padding-right", "8px");
    await expect(fixture.locator("#quad")).toHaveCSS("padding-bottom", "12px");
    await expect(fixture.locator("#quad")).toHaveCSS("padding-left", "16px");
  });

  test("E2: 링크 토글이 4면 다른 요소에서도 동작(눌러서 통일 가능)", async () => {
    const buttons = paddingButtons();
    const toggle = buttons.last();
    // 4면이 다른 상태(99/8/12/16)에서 링크 켜기 → 한 번 입력으로 통일 가능해야 함
    if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
    await buttons.nth(0).click();
    await panel.locator("[cmdk-input]").fill("50px");
    await closeAllPopovers(panel);

    await expect(fixture.locator("#quad")).toHaveCSS("padding-top", "50px");
    await expect(fixture.locator("#quad")).toHaveCSS("padding-right", "50px");
    await expect(fixture.locator("#quad")).toHaveCSS("padding-bottom", "50px");
    await expect(fixture.locator("#quad")).toHaveCSS("padding-left", "50px");
  });
});
