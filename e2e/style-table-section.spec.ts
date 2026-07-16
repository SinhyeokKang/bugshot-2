import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  ensureSectionOpen,
  expect,
  selectStyleValue,
  test,
} from "./fixtures/extension";

// table-section feature: 테이블 속성 전용 Table 섹션(table-layout·border-collapse 등).
// 원 이슈("table-layout이 안 먹힘")를 폼 경로로 가드 — 라이브 적용 + 변경 다이얼로그 행.

test.describe.serial("style-table-section", () => {
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

  test("table-layout fixed가 라이브 적용", async () => {
    // #tbl은 테이블 속성 전부 기본값 → Table 섹션 접힘. 펼친다.
    await enterDebugAndPick(fixture, panel, "#tbl");
    await ensureSectionOpen(panel, "section-table-toggle", "table-layout");

    await selectStyleValue(panel, "table-layout", "fixed");
    await expect(fixture.locator("#tbl")).toHaveCSS("table-layout", "fixed");
  });

  test("변경사항 다이얼로그에 table-layout 행 노출", async () => {
    await trigger().click();
    await expect(dialog()).toBeVisible();
    const row = currentCard().locator('[data-prop="table-layout"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("fixed");
    await panel.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  });
});
