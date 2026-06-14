import { enterDebug, expect, test } from "./fixtures/extension";

// cross-page 로그 누적 — webNavigation onBeforeNavigate 꼬리 sync + onCommitted
// shouldClearLogs 판정(navigation-clear.ts). same-origin 이동은 보존, reload는 클리어.
test.describe.serial("logs cross-page", () => {
  test("same-origin 페이지 이동 후 이전 페이지 로그 보존 + 누적", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-console").click();

    // 레코더 활성화 대기 — 로그 발생 + sync 주기(1500ms) polling.
    await expect(async () => {
      await fixture.evaluate(() => console.log("bugshot-e2e-page-one"));
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-page-one" }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // 꼬리 sync — sync 주기(1500ms)를 기다리지 않고 즉시 이동해, onBeforeNavigate가
    // 떠나는 페이지의 MAIN 버퍼 꼬리를 밀어내는 경로를 태운다. (직전 주기 sync가
    // 선점할 수 있어 완전 격리는 아니지만, 보존 자체는 어느 경로든 단언된다)
    await fixture.evaluate(() => console.log("bugshot-e2e-tail-log"));
    await fixture.goto(ext.fixtureUrl("second.html"));
    await expect(
      panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-tail-log" }),
    ).not.toHaveCount(0, { timeout: 10_000 });
    await expect(
      panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-page-one" }),
    ).not.toHaveCount(0);

    // 새 페이지 로그도 이어서 누적된다.
    await expect(async () => {
      await fixture.evaluate(() => console.log("bugshot-e2e-page-two"));
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-page-two" }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });
    await expect(
      panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-page-one" }),
    ).not.toHaveCount(0);

    await panel.close();
    await fixture.close();
  });

  test("reload 시 로그 클리어", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-console").click();

    await expect(async () => {
      await fixture.evaluate(() => console.log("bugshot-e2e-pre-reload"));
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-pre-reload" }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // reload는 transitionType=reload → logClear → idle phase에선 패널 버퍼도 비운다.
    await fixture.reload();
    await expect(
      panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-pre-reload" }),
    ).toHaveCount(0, { timeout: 10_000 });

    await panel.close();
    await fixture.close();
  });
});
