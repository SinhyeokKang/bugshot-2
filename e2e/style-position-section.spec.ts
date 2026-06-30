import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  ensureSectionOpen,
  expect,
  selectStyleValue,
  setQuadSideValue,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// position-section feature: Layout에서 분리된 독립 Position 섹션.
// position 셀렉트 + inset(top/right/bottom/left) QuadProp + z-index를 한 섹션에서 편집.

test.describe.serial("style-position-section", () => {
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

  const trigger = () => panel.getByTestId("changes-trigger");
  const dialog = () => panel.getByTestId("changes-dialog");
  const currentCard = () =>
    panel.locator('[data-testid="changes-card"][data-source="current"]');

  test("position relative + inset top이 라이브 적용", async () => {
    // #title은 position류 전부 기본값(static/auto) → Position 섹션 접힘. 펼친다.
    await enterDebugAndPick(fixture, panel, "#title");
    await ensureSectionOpen(panel, "section-position-toggle", "position");

    // position을 relative로 → 페이지 즉시 반영.
    await selectStyleValue(panel, "position", "relative");
    await expect(fixture.locator("#title")).toHaveCSS("position", "relative");

    // inset top 12px → relative 요소라 오프셋이 실제로 적용된다.
    await setQuadSideValue(panel, "inset", 0, "12px");
    await expect(fixture.locator("#title")).toHaveCSS("top", "12px");
  });

  test("변경사항 다이얼로그에 position·top 행 노출", async () => {
    await trigger().click();
    await expect(dialog()).toBeVisible();
    await expect(currentCard().locator('[data-prop="position"]')).toHaveCount(1);
    const topRow = currentCard().locator('[data-prop="top"]');
    await expect(topRow).toHaveCount(1);
    await expect(topRow).toContainText("12px");
    await panel.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  });

  test("inset top 비우면 그 변경만 제거(position·z-index 무관)", async () => {
    // z-index도 같은 섹션 — 입력 후 inset만 비워 부분 제거를 확인.
    await typeStyleValue(panel, "z-index", "5");
    await expect(fixture.locator("#title")).toHaveCSS("z-index", "5");

    // relative 요소는 top 미설정 시 computed가 used value 0px(=오프셋 해제). 12px→0px.
    await setQuadSideValue(panel, "inset", 0, "");
    await expect(fixture.locator("#title")).toHaveCSS("top", "0px");

    // position·z-index 변경은 남아 trigger 활성 유지.
    await expect(trigger()).toBeEnabled();
    await trigger().click();
    await expect(dialog()).toBeVisible();
    await expect(currentCard().locator('[data-prop="top"]')).toHaveCount(0);
    await expect(currentCard().locator('[data-prop="position"]')).toHaveCount(1);
    await expect(currentCard().locator('[data-prop="z-index"]')).toHaveCount(1);
    await panel.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  });
});
