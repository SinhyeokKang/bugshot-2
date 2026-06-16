import { enterDebug, expect, test } from "./fixtures/extension";

// 페이지 console.error/warn arm-스코프 캡처 — 패널 열림(arm) 동안 page console.error/warn을
// wrap해 콘솔 로그에 error/warn 레벨로 잡는다. data-level 속성으로 탭 필터 의존 없이 단언.
// iframe도 all_frames wrap이라 캡처된다. 기존 log/info/debug 캡처 회귀는 log-capture.spec가 커버.
test.describe.serial("console error/warn capture", () => {
  test("top frame console.error/warn → error·warn 레벨로 캡처", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-console").click();

    // 레코더 활성화 대기 — console.error 발생 + sync 주기 polling. 잡히면 활성화+error 캡처 동시 확인.
    await expect(async () => {
      await fixture.evaluate(() => console.error("E2E_ERR"));
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator('[data-entry-id][data-level="error"]', { hasText: "E2E_ERR" }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // 활성화된 상태에서 warn도 warn 레벨로 잡힌다.
    await expect(async () => {
      await fixture.evaluate(() => console.warn("E2E_WARN"));
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator('[data-entry-id][data-level="warn"]', { hasText: "E2E_WARN" }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    await panel.close();
    await fixture.close();
  });

  test("iframe 내부 console.error도 error 레벨로 캡처", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("iframe.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-console").click();

    const frame = fixture.frame({ url: /basic\.html/ });
    expect(frame).not.toBeNull();

    await expect(async () => {
      await frame!.evaluate(() => console.error("E2E_IFRAME_ERR"));
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator('[data-entry-id][data-level="error"]', { hasText: "E2E_IFRAME_ERR" }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    await panel.close();
    await fixture.close();
  });
});
