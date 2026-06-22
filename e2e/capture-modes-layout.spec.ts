import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// screen-recording: idle 캡처 진입 화면 1×2×2×1 레이아웃.
// Row1 요소선택 / Row2 요소캡처·범위캡처 / Row3 탭 녹화·화면 녹화 / Row4 30s 리플레이(단독).
// 실제 getDisplayMedia 녹화는 자동화 불가(수동 잔여) — 여기선 버튼 노출·DOM 구조만 판정.

test.describe("capture-modes-layout: idle 1×2×2×1", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("idle에 6개 캡처 진입 버튼이 모두 노출된다", async () => {
    for (const id of [
      "mode-element",
      "mode-element-shot",
      "mode-screenshot",
      "mode-video",
      "mode-screen-record",
      "replay-button",
    ]) {
      await expect(panel.getByTestId(id)).toBeVisible();
    }
  });

  test("탭 녹화·화면 녹화는 같은 ButtonGroup, 리플레이는 그 밖(Row4 단독)", async () => {
    // mode-video를 품은 ButtonGroup(role=group)에 mode-screen-record가 같이 있고
    // replay-button은 그 그룹 밖에 있어야 한다(위치 단언이 아닌 DOM 부모 구조).
    const recordGroup = panel.locator('[data-slot="button-group"]', {
      has: panel.getByTestId("mode-video"),
    });
    await expect(recordGroup.getByTestId("mode-screen-record")).toHaveCount(1);
    await expect(recordGroup.getByTestId("replay-button")).toHaveCount(0);
  });
});
