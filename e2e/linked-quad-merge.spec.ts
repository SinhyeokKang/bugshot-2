import type { Page } from "@playwright/test";
import {
  closeAllPopovers,
  enterDebugAndPick,
  expect,
  setQuadLinkedValue,
  setQuadStyleLinkedValue,
  test,
} from "./fixtures/extension";

// linked-quad-merge: linked 모드일 때 박스모델 4면 필드를 단일 필드 1개로 병합 표시.
// unlinked는 기존 4필드 유지. 저장 모델은 면별 longhand라 diff는 shorthand로 collapse.
// border-width/style/color 셋 다 4면 동일 변경 시 변경사항 다이얼로그에 `border` 한 행.
// #el1(.swatch): padding 12px·border 1px solid #ddd 4면 동일 → 묶음들이 linked로 시작.
test.describe.serial("linked-quad-merge", () => {
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

  const paddingRow = () =>
    panel.locator("section").getByText("padding", { exact: true }).locator("..");
  const el1 = () => fixture.locator("#el1");

  test("1. padding 4면 동일 요소 → linked 단일 필드 1개만 렌더", async () => {
    await enterDebugAndPick(fixture, panel, "#el1");
    // padding 12px 4면 동일 → linked 자동 시작 → 병합 단일 필드, per-side grid 부재
    await expect(paddingRow().getByTestId("merged-side-field")).toBeVisible();
    await expect(paddingRow().getByTestId("quad-sides")).toHaveCount(0);
  });

  test("2. LinkToggle 끄면 per-side 4필드로 펼쳐짐", async () => {
    // LinkToggle = padding row 마지막 버튼
    await paddingRow().locator("button").last().click();
    const sides = paddingRow().getByTestId("quad-sides");
    await expect(sides).toBeVisible();
    // per-side 트리거 4개(LinkToggle은 quad-sides 밖 형제라 미포함)
    await expect(sides.locator("button")).toHaveCount(4);
    await expect(paddingRow().getByTestId("merged-side-field")).toHaveCount(0);
  });

  test("3. linked 단일 필드에 16px 입력 → 4면 모두 16px", async () => {
    // 토글 켜고(setQuadLinkedValue 내장) 단일 필드에 입력 → setAllProps로 4면 동일
    await setQuadLinkedValue(panel, "padding", "16px");
    await expect(el1()).toHaveCSS("padding-top", "16px");
    await expect(el1()).toHaveCSS("padding-right", "16px");
    await expect(el1()).toHaveCSS("padding-bottom", "16px");
    await expect(el1()).toHaveCSS("padding-left", "16px");
    // 단일 필드 유지(linked) 확인
    await expect(paddingRow().getByTestId("merged-side-field")).toBeVisible();
  });

  test("4. 변경사항 다이얼로그에 padding 한 행 collapse (longhand 행 부재)", async () => {
    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();

    await expect(
      panel.locator('[data-testid="changes-row"][data-prop="padding"]'),
    ).toHaveCount(1);
    await expect(
      panel.locator('[data-testid="changes-row"][data-prop="padding-top"]'),
    ).toHaveCount(0);

    await panel.keyboard.press("Escape");
    await expect(panel.getByTestId("changes-dialog")).toBeHidden();
  });

  test("5. border width/style/color 셋 다 linked 동일 변경 → border 한 행 통합", async () => {
    // #el1 baseline 1px solid #ddd → 2px dashed red 로 셋 다 변경(셋 다 변경돼야 2차 통합)
    await setQuadLinkedValue(panel, "border-width", "2px");
    await setQuadStyleLinkedValue(panel, "border-style", "dashed");
    await closeAllPopovers(panel);
    await setQuadLinkedValue(panel, "border-color", "red");

    await expect(el1()).toHaveCSS("border-top-width", "2px");
    await expect(el1()).toHaveCSS("border-top-style", "dashed");

    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();

    const borderRow = panel.locator(
      '[data-testid="changes-row"][data-prop="border"]',
    );
    await expect(borderRow).toHaveCount(1);
    await expect(borderRow).toContainText("2px dashed red");
    // 2차 통합되어 개별 border-width/style/color 행은 사라짐
    await expect(
      panel.locator('[data-testid="changes-row"][data-prop="border-width"]'),
    ).toHaveCount(0);
    await expect(
      panel.locator('[data-testid="changes-row"][data-prop="border-style"]'),
    ).toHaveCount(0);

    await panel.keyboard.press("Escape");
    await expect(panel.getByTestId("changes-dialog")).toBeHidden();
  });
});
