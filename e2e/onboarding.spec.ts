import { expect, test } from "./fixtures/extension";

// 온보딩 자동 라우팅 — 연동 플랫폼 0개면 settingsHydrated 후 integrations 탭으로 자동 전환.
// (e2e 프로필은 플랫폼을 연결하지 않으므로 항상 이 경로를 탄다)
test("연동 0개 → integrations 탭 자동 진입", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await expect(panel.getByTestId("tab-integrations")).toHaveAttribute(
    "data-state",
    "active",
  );

  await panel.close();
  await fixture.close();
});
