import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  expect,
  setQuadLinkedValue,
  setQuadSideValue,
  setQuadStyleLinkedValue,
  setQuadStyleSideValue,
  test,
} from "./fixtures/extension";

// per-side-border-editing: 별도 Border 섹션에서 border를 margin/padding처럼 변별 편집
// (border-width 4변 QuadProp + border-color 4변 QuadProp + border-style 4변 QuadStyleProp).
// #el1(.swatch)은 `border: 1px solid #dddddd` baseline을 가져 computed border-*-width가
// style:none→0px로 resolve되는 함정 없이 라이브 반영을 그대로 확인할 수 있다.
test.describe.serial("border-per-side", () => {
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

  const el1 = () => fixture.locator("#el1");

  test("1. border-width 한 변(bottom) 입력 → 그 변만 라이브 반영", async () => {
    await enterDebugAndPick(fixture, panel, "#el1");
    // idx 2 = bottom (top0 right1 bottom2 left3)
    await setQuadSideValue(panel, "border-width", 2, "4px");
    await expect(el1()).toHaveCSS("border-bottom-width", "4px");
    // 나머지 변은 .swatch baseline(1px) 유지
    await expect(el1()).toHaveCSS("border-top-width", "1px");
  });

  test("2. 링크 토글로 네 변 동일(3px) 일괄 적용", async () => {
    await setQuadLinkedValue(panel, "border-width", "3px");
    await expect(el1()).toHaveCSS("border-top-width", "3px");
    await expect(el1()).toHaveCSS("border-right-width", "3px");
    await expect(el1()).toHaveCSS("border-bottom-width", "3px");
    await expect(el1()).toHaveCSS("border-left-width", "3px");
  });

  test("3. 네 변 동일 → 변경사항 다이얼로그에 border-width 단일 행 collapse", async () => {
    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();

    await expect(
      panel.locator('[data-testid="changes-row"][data-prop="border-width"]'),
    ).toHaveCount(1);
    await expect(
      panel.locator('[data-testid="changes-row"][data-prop="border-top-width"]'),
    ).toHaveCount(0);

    await panel.keyboard.press("Escape");
    await expect(panel.getByTestId("changes-dialog")).toBeHidden();
  });

  test("4. border-style 링크 토글로 네 변 일괄(dashed) 적용", async () => {
    await setQuadStyleLinkedValue(panel, "border-style", "dashed");
    await expect(el1()).toHaveCSS("border-top-style", "dashed");
    await expect(el1()).toHaveCSS("border-right-style", "dashed");
    await expect(el1()).toHaveCSS("border-bottom-style", "dashed");
    await expect(el1()).toHaveCSS("border-left-style", "dashed");
  });

  test("5. border-style 한 변(top)만 dotted → 그 변만 반영", async () => {
    await setQuadStyleSideValue(panel, "border-style", 0, "dotted");
    await expect(el1()).toHaveCSS("border-top-style", "dotted");
    await expect(el1()).toHaveCSS("border-bottom-style", "dashed");
  });

  test("6. border-color 한 변(top) 입력 → 그 변만 라이브 반영 (캡처 버그 픽스 경로)", async () => {
    await setQuadSideValue(panel, "border-color", 0, "#ff0000");
    await expect(el1()).toHaveCSS("border-top-color", "rgb(255, 0, 0)");
    // 나머지 변은 .swatch baseline(#dddddd) 유지
    await expect(el1()).toHaveCSS("border-bottom-color", "rgb(221, 221, 221)");
  });
});
