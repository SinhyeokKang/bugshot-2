import { enterDebug, expect, test } from "./fixtures/extension";

// origin 필터 — 같은 fixture 서버를 127.0.0.1(top)과 localhost(iframe) 두 호스트로 접근하면
// origin이 갈라진다. cross-origin 로그가 2개 origin 이상 섞이면 OriginFilterBar가 노출되고,
// 필터 클릭 → 해당 origin만 / 재클릭 → 전체 복귀.
test("cross-origin 로그 → origin 필터 노출·필터링·해제", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("cross-origin.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("subtab-console").click();

  const port = new URL(ext.fixtureUrl("")).port;
  const topOrigin = `http://127.0.0.1:${port}`;
  const frameOrigin = `http://localhost:${port}`;
  const frame = fixture.frame({ url: /localhost.*basic\.html/ });
  expect(frame).not.toBeNull();

  // 두 origin에서 각각 로그 발생 → 둘 다 잡힐 때까지 polling.
  await expect(async () => {
    await fixture.evaluate(() => console.log("bugshot-e2e-origin-top"));
    await frame!.evaluate(() => console.log("bugshot-e2e-origin-frame"));
    await panel.waitForTimeout(1700);
    await expect(
      panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-origin-top" }),
    ).not.toHaveCount(0);
    await expect(
      panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-origin-frame" }),
    ).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });

  // origin 2개 → 필터 바 노출.
  const topFilter = panel.locator(
    `[data-testid="origin-filter"][data-origin="${topOrigin}"]`,
  );
  const frameFilter = panel.locator(
    `[data-testid="origin-filter"][data-origin="${frameOrigin}"]`,
  );
  await expect(topFilter).toBeVisible();
  await expect(frameFilter).toBeVisible();

  // localhost 필터 → frame 로그만 남는다.
  await frameFilter.click();
  await expect(
    panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-origin-frame" }),
  ).not.toHaveCount(0);
  await expect(
    panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-origin-top" }),
  ).toHaveCount(0);

  // 재클릭 → 필터 해제, 전체 복귀.
  await frameFilter.click();
  await expect(
    panel.locator("[data-entry-id]", { hasText: "bugshot-e2e-origin-top" }),
  ).not.toHaveCount(0);

  await panel.close();
  await fixture.close();
});
