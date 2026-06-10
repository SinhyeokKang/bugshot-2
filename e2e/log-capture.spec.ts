import { enterDebug, expect, test } from "./fixtures/extension";

// 패널이 열리면 useBackgroundRecorder가 console/network 레코더를 자동 주입(sentinel 발행)한다.
// 활성화 완료 신호가 없어, 로그 발생 + sync 주기(1500ms) 대기를 polling으로 반복해
// 첫 캡처가 잡힐 때까지 기다린다. action 로그는 video 모드 종속 뷰라 여기서 다루지 않는다(수동 잔여).
// cross-origin iframe origin 필터도 단일 fixture 서버 origin 제약으로 수동 잔여.
test.describe.serial("log capture", () => {
  test("console 로그 수집 → 항목 표시 → clear", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-console").click();
    await expect(panel.getByTestId("subtab-console")).toHaveAttribute(
      "data-state",
      "active",
    );

    // 레코더 활성화 전 로그는 무시되므로, 로그 발생 + sync 대기를 항목이 잡힐 때까지 반복.
    await expect(async () => {
      await fixture.evaluate(() =>
        console.log("bugshot-e2e-console", performance.now()),
      );
      await panel.waitForTimeout(1700);
      await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // clear → 비움. lastLogClearAt 필터로 이전 버퍼 재유입 차단.
    await panel.getByTestId("console-clear").click();
    await expect(panel.locator("[data-entry-id]")).toHaveCount(0);

    await panel.close();
    await fixture.close();
  });

  test("network 요청 수집 → 항목 표시", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-network").click();
    await expect(panel.getByTestId("subtab-network")).toHaveAttribute(
      "data-state",
      "active",
    );

    await expect(async () => {
      await fixture.evaluate(() =>
        fetch("/e2e-ping-" + performance.now()).catch(() => {}),
      );
      await panel.waitForTimeout(1700);
      await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    await panel.close();
    await fixture.close();
  });
});
