import type { Page } from "@playwright/test";
import { enterDebugAndPick, expect, test } from "./fixtures/extension";

// length 토큰을 다른 토큰으로 바꾸면 필드 우측 미리보기(hint)가 갱신되는지 검증.
// 회귀: 이전엔 hint가 selection.computedStyles(편집 전 baseline)에 묶여 토큰을 바꿔도
// stale했다. 수정 후 rightHintText가 토큰 정의값(findTokenValue)을 우선 표시한다.
// fixture :root에 --space-sm(8px)/--space-lg(32px) 정의.

test.describe.serial("style-token-hint: length 토큰 변경 시 미리보기 갱신", () => {
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

  const widthRow = () =>
    panel.locator("section").getByText("width", { exact: true }).locator("..");
  const hint = () => widthRow().getByTestId("token-value-hint");
  // 콤보박스 트리거 클릭 후 팝오버(cmdk-input)가 실제 렌더될 때까지 대기 —
  // 부하 시 렌더 지연으로 뒤이은 item 클릭이 타임아웃하던 flake 방지.
  const openWidth = async () => {
    await widthRow().locator("button").first().click();
    await expect(panel.locator("[cmdk-input]")).toBeVisible();
  };
  // item이 실제 렌더될 때까지 대기 후 클릭 — 부하 시 렌더 지연 flake 방지.
  // fill로 필터하면 "__raw__" 직접입력 항목이 추가로 떠 hasText가 2개에 걸리므로 쓰지 않는다.
  const pickToken = async (name: string) => {
    const item = panel.locator("[cmdk-item]", { hasText: name });
    await expect(item).toBeVisible();
    await item.click();
  };

  test("토큰 A 선택 → hint가 A 원시값, 토큰 B 변경 → hint 갱신", async () => {
    // #el1 (swatch width:200px) — size 섹션 defaultOpen
    await enterDebugAndPick(fixture, panel, "#el1");

    // 토큰 A(--space-sm=8px) 선택
    await openWidth();
    await pickToken("--space-sm");
    await expect(fixture.locator("#el1")).toHaveCSS("width", "8px");
    // hint는 토큰 정의값(8px)을 표시 — 버그면 computed baseline("200px")로 stale
    await expect(hint()).toHaveText("8px");

    // 토큰 B(--space-lg=32px)로 변경 → hint 갱신
    await openWidth();
    await pickToken("--space-lg");
    await expect(fixture.locator("#el1")).toHaveCSS("width", "32px");
    await expect(hint()).toHaveText("32px");
  });
});
