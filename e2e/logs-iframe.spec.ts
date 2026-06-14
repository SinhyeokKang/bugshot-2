import { enterDebug, expect, test } from "./fixtures/extension";

// iframe 로그 커버리지 — recorder-bridge(ISOLATED)·recorders-entry(MAIN)는 all_frames 주입.
// 패널 활성화 시 sentinel이 모든 프레임에 닿아, iframe 내부 console 로그도 패널에 잡혀야 한다.
// (picker는 top frame 한정이지만 로그 레코더는 별개 — ARCHITECTURE "iframe 로그 커버리지")
test("iframe 내부 console 로그가 패널에 캡처된다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("iframe.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("subtab-console").click();

  const frame = fixture.frame({ url: /basic\.html/ });
  expect(frame).not.toBeNull();

  await expect(async () => {
    await frame!.evaluate(() => console.log("bugshot-e2e-iframe-log"));
    await panel.waitForTimeout(1700);
    await expect(
      panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-iframe-log" }),
    ).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });

  await panel.close();
  await fixture.close();
});
