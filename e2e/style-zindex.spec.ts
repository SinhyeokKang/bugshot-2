import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  ensureSectionOpen,
  expect,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// element-zindex feature: Position 섹션 z-index 편집.
// z-index 입력 → 라이브 적용 + 변경 행 노출 / 비우기 → 변경 제거(키 delete).

test.describe.serial("style-zindex: edit + clear", () => {
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

  test("z-index 입력이 라이브 적용 + 변경 행 노출", async () => {
    // #title은 z-index 미지정(computed auto). 9999 입력 → 즉시 적용.
    // z-index는 이제 Position 섹션 — #title은 position류 기본값이라 섹션이 접혀 있어 펼친다.
    await enterDebugAndPick(fixture, panel, "#title");
    await ensureSectionOpen(panel, "section-position-toggle", "z-index");
    await typeStyleValue(panel, "z-index", "9999");
    await expect(fixture.locator("#title")).toHaveCSS("z-index", "9999");

    await trigger().click();
    await expect(dialog()).toBeVisible();
    const row = currentCard().locator('[data-prop="z-index"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("9999");
    await panel.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  });

  test("z-index 비우면 변경이 제거되어 원본(auto) 복원", async () => {
    // 입력란을 비우면 inlineStyle["z-index"] 키 삭제 → 원본 복원, 변경 0건.
    await typeStyleValue(panel, "z-index", "");
    await expect(fixture.locator("#title")).toHaveCSS("z-index", "auto");
    // z-index가 유일한 변경이었으므로 trigger가 다시 비활성(count 0).
    await expect(trigger()).toBeDisabled();
  });
});
