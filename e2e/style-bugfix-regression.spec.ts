import type { Page } from "@playwright/test";
import {
  closeAllPopovers,
  enterDebugAndPick,
  expect,
  pickElement,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// 스타일 패널 버그픽스 회귀(style-panel-bug-hunt 리포트):
// #4 baseline 동일값 → phantom diff 없음 / #1 line-height unitless 미px화 /
// #3 named-color 토큰 분류 / #5 단축 hex 라이브 미확장(blur 시에만 확장) /
// #6 multiplier 토큰 hint / #7 unitless 0 토큰 분류.

test.describe.serial("style-bugfix-regression", () => {
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

  const row = (label: string) =>
    panel.locator("section").getByText(label, { exact: true }).locator("..");

  const repick = async (selector: string) => {
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await fixture.locator(selector).scrollIntoViewIfNeeded();
    await pickElement(fixture, panel, selector);
    await expect(panel.getByTestId("repick")).toBeVisible();
  };

  test("#4: baseline과 동일한 값 입력은 phantom diff를 만들지 않음", async () => {
    // #el1 (.swatch width:200px). 동일값 200px 입력 → 변경 0건
    await enterDebugAndPick(fixture, panel, "#el1");
    await typeStyleValue(panel, "width", "200px");
    await expect(fixture.locator("#el1")).toHaveCSS("width", "200px");
    // 변경 게이트 비활성 (hasStyleChange false) — 트리거 disabled
    await expect(panel.getByTestId("changes-trigger")).toBeDisabled();
  });

  test("#1: line-height unitless 입력은 px로 강제되지 않음", async () => {
    await repick("#title");
    const fs = await fixture
      .locator("#title")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await typeStyleValue(panel, "line-height", "2");
    // 정상: unitless 2 = 2 × font-size. 버그면 "2px"(=2px computed).
    await expect(fixture.locator("#title")).toHaveCSS(
      "line-height",
      `${fs * 2}px`,
    );
  });

  test("#3: named-color 토큰(--brand: tomato)이 color 드롭다운에 표시됨", async () => {
    await row("color").locator("button").first().click();
    await expect(
      panel.locator("[cmdk-item]", { hasText: "--brand" }),
    ).toBeVisible();
    await closeAllPopovers(panel);
  });

  test("#5: 단축 hex는 타이핑 중 미확장, blur 시에만 확장", async () => {
    // #title 유지(typography 섹션 열림). color에 단축 hex 'abc' 타이핑.
    const aabbcc = "rgb(170, 187, 204)"; // #aabbcc
    await row("color").locator("button").first().click();
    const input = panel.locator("[cmdk-input]");
    await input.pressSequentially("abc");
    // 라이브: 단축 hex 미확장 → invalid → 페이지 색 미적용
    await expect(fixture.locator("#title")).not.toHaveCSS("color", aabbcc);
    await closeAllPopovers(panel);
    // blur: expandShortHex 적용 → #aabbcc
    await expect(fixture.locator("#title")).toHaveCSS("color", aabbcc);
  });

  test("#6: multiplier 토큰의 hint가 곱셈 반영(8px×2=16px)", async () => {
    await repick("#multi");
    // #multi width = calc(var(--space-sm) * 2), --space-sm=8px → hint 16px
    await expect(row("width").getByTestId("token-value-hint")).toHaveText("16px");
  });

  test("#7: unitless 0 토큰(--space-0)이 length 필드 드롭다운에 표시됨", async () => {
    await row("width").locator("button").first().click();
    await expect(
      panel.locator("[cmdk-item]", { hasText: "--space-0" }),
    ).toBeVisible();
    await closeAllPopovers(panel);
  });
});
