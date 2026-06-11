import type { Page } from "@playwright/test";
import {
  closeAllPopovers,
  enterDebugAndPick,
  expect,
  pickElement,
  test,
} from "./fixtures/extension";

// 회귀: 버퍼된 요소를 재선택해 추가 편집 후 다음 element로 넘어가면, 재선택 시 작업 set이
// 비워져 재버퍼 때 이전 편집(py 등)이 변경사항 목록에서 소실됐던 버그.
// 수정: onElementSelected가 버퍼된 selector 재선택 시 그 편집을 복원한다.
test.describe.serial("buffered-reselect-edit", () => {
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

  // padding QuadProp 한 면만 입력 (unlink 상태 가정). idx: top0 right1 bottom2 left3, toggle=last
  async function setQuadSide(idx: number, value: string) {
    const row = panel.locator("section").getByText("padding", { exact: true }).locator("..");
    await row.locator("button").nth(idx).click();
    await panel.locator("[cmdk-input]").fill(value);
    await closeAllPopovers(panel);
  }

  async function unlinkPadding() {
    const row = panel.locator("section").getByText("padding", { exact: true }).locator("..");
    const toggle = row.locator("button").last();
    if ((await toggle.getAttribute("aria-pressed")) === "true") await toggle.click();
  }

  test("py 수정 후 repick → buffered에 padding-top/bottom 유지", async () => {
    await enterDebugAndPick(fixture, panel, "#title");
    await unlinkPadding();
    await setQuadSide(0, "20px"); // padding-top
    await setQuadSide(2, "20px"); // padding-bottom

    // 적용 확인
    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "20px");
    await expect(fixture.locator("#title")).toHaveCSS("padding-bottom", "20px");

    // changes dialog (current) 확인
    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();
    const cur = panel.locator('[data-testid="changes-card"][data-source="current"]');
    await expect(cur.locator('[data-prop="padding-top"]')).toHaveCount(1);
    await expect(cur.locator('[data-prop="padding-bottom"]')).toHaveCount(1);
    await panel.keyboard.press("Escape");
    await expect(panel.getByTestId("changes-dialog")).toBeHidden();

    // 다음 element로 repick
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#card");
    await expect(panel.getByTestId("repick")).toBeVisible();

    // buffered card에 padding-top/bottom 행이 남아있어야 한다
    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();
    const buf = panel.locator('[data-testid="changes-card"][data-source="buffered"]');
    await expect(buf).toHaveCount(1);
    await expect(buf.locator('[data-prop="padding-top"]')).toHaveCount(1);
    await expect(buf.locator('[data-prop="padding-bottom"]')).toHaveCount(1);
    await panel.keyboard.press("Escape");
    await expect(panel.getByTestId("changes-dialog")).toBeHidden();
  });

  test("재선택한 buffered 요소에 다른 면(px) 추가 → repick 시 py·px 모두 유지", async () => {
    // #title 재선택 — inlineStyle은 {}로 리셋되지만 py는 DOM/specified에 남아 패널엔 보인다.
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#title");
    await expect(panel.getByTestId("repick")).toBeVisible();

    // 패널 padding-top 필드엔 여전히 20px이 보인다 (specified placeholder)
    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "20px");

    // px(왼쪽) 한 면만 추가 편집
    await unlinkPadding();
    await setQuadSide(3, "10px"); // padding-left

    // 다음 element로 repick → buffered #title 재기록
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#card");
    await expect(panel.getByTestId("repick")).toBeVisible();

    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();
    const buf = panel.locator('[data-testid="changes-card"][data-source="buffered"]');
    // py(top/bottom)가 유지되고 새로 추가한 px(left)도 함께 기록돼야 한다
    await expect(buf.locator('[data-prop="padding-top"]')).toHaveCount(1);
    await expect(buf.locator('[data-prop="padding-bottom"]')).toHaveCount(1);
    await expect(buf.locator('[data-prop="padding-left"]')).toHaveCount(1);
  });
});
