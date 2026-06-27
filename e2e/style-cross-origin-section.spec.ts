import type { Page } from "@playwright/test";
import { enterDebugAndPick, expect, test } from "./fixtures/extension";

// 회귀: cross-origin stylesheet에서만 스타일을 받는 요소를 선택하면 specified(author rule)
// 채널이 비어 모든 스타일 섹션이 접힌 채 시작 → "값은 있는데 안 보임" 상태였다.
// 수정 후 specified가 전무하면 computed fallback으로 값이 있는 섹션을 기본 펼침한다.
// (naver 로그인 버튼 = pstatic.net의 cross-origin CSS와 같은 구조)
test.describe.serial("style-cross-origin-section: cross-origin이면 computed로 섹션 펼침", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("cross-origin-style.html"));
    // cross-origin sheet 적용 확인 — 미적용이면 computed가 baseline이라 회귀가 드러나지 않는다.
    await expect(fixture.locator("#target")).toHaveCSS("display", "grid");
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("specified 빔 → layout·size 섹션이 펼쳐져 computed 값 노출", async () => {
    await enterDebugAndPick(fixture, panel, "#target");

    // 섹션이 펼쳐져야 prop 행이 렌더된다(접힘이면 children 미렌더 → 회귀 시 빨강).
    await expect(
      panel.locator("section").getByText("display", { exact: true }),
    ).toBeVisible();
    await expect(
      panel.locator("section").getByText("width", { exact: true }),
    ).toBeVisible();
  });
});
