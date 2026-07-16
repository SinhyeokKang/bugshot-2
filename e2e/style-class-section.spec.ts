import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  expect,
  pickElement,
  test,
} from "./fixtures/extension";

// style-class-section: Class 섹션은 class 없는 요소에서 세로 공간만 먹으므로,
// 원본 class가 비면 접힘 기본값(collapsible). class 있으면 펼침, 접혀도 토글로 펼쳐 추가 가능.
test.describe.serial("style-class-section", () => {
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

  test("class 있는 요소 → Class 섹션 펼침", async () => {
    // #card class="card box" → classList 2개 → 펼침.
    await enterDebugAndPick(fixture, panel, "#card");
    await expect(panel.getByTestId("class-editor")).toBeVisible();
    await expect(panel.getByTestId("class-editor")).toHaveValue("card box");
  });

  test("class 없는 요소 → Class 섹션 접힘, 토글로 펼침 가능", async () => {
    // #title은 id만·class 없음 → 접힘.
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#title");
    await expect(panel.getByTestId("repick")).toBeVisible();

    // 접힘: 자식(class-editor)이 DOM에서 제거, 토글은 노출.
    await expect(panel.getByTestId("class-editor")).toBeHidden();
    await expect(panel.getByTestId("section-class-toggle")).toBeVisible();

    // 토글 클릭 → 펼침(빈 요소에도 class 추가 가능).
    await panel.getByTestId("section-class-toggle").click();
    await expect(panel.getByTestId("class-editor")).toBeVisible();
  });
});
