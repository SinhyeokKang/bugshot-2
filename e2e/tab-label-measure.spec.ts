import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/extension";

// 접힌 라벨은 sr-only(1px)라 측정 중 not-sr-only가 덮어야 펼친 폭이 잡힌다. jsdom은 CSS와
// 레이아웃이 없어 이 등가성을 못 본다 — 같은 폰트 환경에서 펼친 폭과 측정 중 폭을 맞댄다.
// hidden/inline 시절과의 절대 비교는 수동 잔여.
const LABEL = '[data-testid="tab-debug"] > span';

async function labelWidth(panel: Page) {
  return panel.locator(LABEL).evaluate((el) => el.getBoundingClientRect().width);
}

test("접힌 라벨도 측정 중에는 펼친 폭과 같다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const panel = await ext.openPanel(await ext.fixtureTabId());
  try {
    await panel.setViewportSize({ width: 900, height: 700 });
    await expect(panel.locator(LABEL)).not.toHaveClass(/(^|\s)sr-only(\s|$)/);
    const expanded = await labelWidth(panel);
    expect(expanded).toBeGreaterThan(10);

    await panel.setViewportSize({ width: 160, height: 700 });
    await expect(panel.locator(LABEL)).toHaveClass(/(^|\s)sr-only(\s|$)/);
    expect(await labelWidth(panel)).toBeLessThanOrEqual(2);

    const measuring = await panel.getByRole("tablist").first().evaluate((list) => {
      list.setAttribute("data-measuring", "true");
      const w = list.querySelector('[data-testid="tab-debug"] > span')!.getBoundingClientRect().width;
      list.removeAttribute("data-measuring");
      return w;
    });
    expect(Math.abs(measuring - expanded)).toBeLessThan(0.5);
  } finally {
    await panel.close();
    await fixture.close();
  }
});
