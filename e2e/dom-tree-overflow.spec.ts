import type { Page } from "@playwright/test";
import { enterDebugAndPick, expect, test } from "./fixtures/extension";

// DOM 트리 노드 라벨이 좁은 사이드패널에서 말줄임으로 잘리던 문제 — 라벨 truncate를
// 걷어내고 트리 전체를 가로 스크롤로 바꿨다. 레이아웃 축이라 jsdom으로는 원리상 못 잡는다.
// 전제(스크롤이 실제로 발생하는가)를 첫 단언으로 박아, 픽스처가 얕아져 넘칠 게 없어지면
// 조용한 green이 아니라 그 자리에서 red가 나게 한다.
// mutation 실측: 스크롤 래퍼의 `w-max min-w-full` → `w-full`이면 행 폭 단언이 red(380 < 549).
// 라벨의 truncate 제거는 이 그물로 red가 안 난다 — w-max 부모가 라벨에 max-content 폭을
// 주므로 클리핑될 게 없어 결과가 동등하다(방어적 정리이지 독립 관측 대상이 아님).
test.describe.serial("dom-tree-overflow", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("dom-tree-deep.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("깊은 노드 라벨이 잘리지 않고 트리가 가로 스크롤된다", async () => {
    await enterDebugAndPick(fixture, panel, "#deep-target");

    await panel.getByTestId("dom-tree-trigger").click();
    const scroller = panel.getByTestId("dom-tree-scroll");
    await expect(scroller).toBeVisible();

    // 전제: 콘텐츠가 컨테이너보다 넓어 가로 스크롤이 실제로 발생한다.
    const overflow = await scroller.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeGreaterThan(0);

    // 라벨 자체는 클리핑되지 않는다 — truncate(overflow:hidden)면 scrollWidth > clientWidth.
    const deepRow = panel
      .getByTestId("dom-tree-node")
      .filter({ hasText: "deep-target" })
      .first();
    await expect(deepRow).toBeVisible();
    const label = deepRow.getByTestId("dom-tree-label");
    const clipped = await label.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(clipped).toBe(0);
    await expect(label).toHaveCSS("white-space", "nowrap");

    // hover 배경이 들쭉날쭉해지지 않도록 모든 행이 스크롤 폭 전체를 차지한다.
    const widths = await panel
      .getByTestId("dom-tree-node")
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).offsetWidth));
    expect(new Set(widths).size).toBe(1);
    const scrollWidth = await scroller.evaluate((el) => el.scrollWidth);
    expect(widths[0]).toBeGreaterThanOrEqual(scrollWidth - 2);
  });
});
