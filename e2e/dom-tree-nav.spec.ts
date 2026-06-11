import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  expect,
  setQuadSideValue,
  test,
} from "./fixtures/extension";

// 회귀: DOM 트리 다이얼로그로 이동하면 현재 요소 편집이 버퍼에 안 담겨 변경사항에서
// 소실됐다(DOM 편집은 페이지에 남은 채). DomNav·repick은 useBufferThenSwitch를 거치는데
// DomTree.handleSelect만 selectByPath를 직접 호출한 누락. 수정: handleSelect도 bufferThenSwitch 경유.
test.describe.serial("dom-tree-nav", () => {
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

  test("py 편집 후 DOM 트리로 이동 → 편집이 buffered로 유지", async () => {
    await enterDebugAndPick(fixture, panel, "#title");
    await setQuadSideValue(panel, "padding", 0, "20px"); // padding-top (unlink 포함)
    await setQuadSideValue(panel, "padding", 2, "20px"); // padding-bottom

    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "20px");
    await expect(fixture.locator("#title")).toHaveCSS("padding-bottom", "20px");

    // DOM 트리 다이얼로그를 열고 형제 요소(#card)로 이동
    await panel.getByTestId("dom-tree-trigger").click();
    const cardNode = panel
      .getByTestId("dom-tree-node")
      .filter({ hasText: "card" })
      .first();
    await expect(cardNode).toBeVisible();
    await cardNode.click();

    // #card styling 화면으로 진입 완료 (repick 버튼 = styling)
    await expect(panel.getByTestId("repick")).toBeVisible();

    // #title의 py 편집이 buffered 카드로 유지돼야 한다 (회귀 전엔 변경사항에서 소실)
    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();
    const buf = panel.locator(
      '[data-testid="changes-card"][data-source="buffered"]',
    );
    await expect(buf).toHaveCount(1);
    await expect(buf.locator('[data-prop="padding-top"]')).toHaveCount(1);
    await expect(buf.locator('[data-prop="padding-bottom"]')).toHaveCount(1);
    await panel.keyboard.press("Escape");
    await expect(panel.getByTestId("changes-dialog")).toBeHidden();

    // 페이지 DOM에도 편집이 그대로 유지된다
    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "20px");
  });
});
