import { expect, test } from "./fixtures/extension";

// 탭 모드(패널을 일반 탭으로 연 경우)에서 ?tabId= 없이 열면 대상 선택 화면이 먼저 온다.
// 선택 화면 뒤에서 부작용 훅이 null tabId를 받는지·"캡처할 수 없습니다" 잔상이 없는지는 jsdom
// (App.tabTarget.test.tsx)이 지킨다. 여기선 실 Chromium에서 선택 → 리로드 → 캡처 진입까지의 흐름을 본다.
const FIXTURE_URL = "http://127.0.0.1/basic.html";

test.describe("탭 모드 — 대상 선택·안내", () => {
  test("쿼리 없이 열면 선택 화면 → 후보를 누르면 tabId가 박히고 캡처 진입 화면", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId(FIXTURE_URL);

    const panel = await ext.context.newPage();
    try {
      await panel.goto(`chrome-extension://${ext.extensionId}/src/sidepanel/index.html`);
      await expect(panel.getByTestId("tab-target-picker")).toBeVisible();
      await expect(panel.getByTestId("tab-mode-agent-hint")).toContainText("#__BUGSHOT_AGENT__");
      // 선택 전에는 캡처 진입 화면이 그려지지 않는다.
      await expect(panel.getByTestId("capture-unsupported")).toHaveCount(0);
      await expect(panel.getByTestId("mode-screenshot")).toHaveCount(0);

      await panel.getByTestId(`tab-target-option-${tabId}`).click();
      await panel.waitForURL((u) => u.searchParams.get("tabId") === String(tabId));
      await expect(panel.getByTestId("tab-target-picker")).toHaveCount(0);
      await expect(panel.getByTestId("mode-screenshot")).toBeVisible();
      await expect(panel.getByTestId("tab-mode-agent-hint")).toContainText("#__BUGSHOT_AGENT__");
    } finally {
      await panel.close();
      await fixture.close();
    }
  });

  test("선택 화면의 목록은 탭이 새로 열리면 갱신된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const fixtureTabId = await ext.fixtureTabId(FIXTURE_URL);
    const panel = await ext.context.newPage();
    let extra: Awaited<ReturnType<typeof ext.context.newPage>> | undefined;
    try {
      await panel.goto(`chrome-extension://${ext.extensionId}/src/sidepanel/index.html`);
      await expect(panel.getByTestId("tab-target-picker")).toBeVisible();
      // picker 셸은 목록 로드 전에도 보인다 — 첫 후보가 뜬 뒤에 센다.
      await expect(panel.getByTestId(`tab-target-option-${fixtureTabId}`)).toBeVisible();
      const before = await panel.getByTestId(/^tab-target-option-/).count();

      extra = await ext.context.newPage();
      await extra.goto(ext.fixtureUrl("basic.html"));
      await expect(panel.getByTestId(/^tab-target-option-/)).toHaveCount(before + 1);
    } finally {
      await extra?.close();
      await panel.close();
      await fixture.close();
    }
  });

  test("영역 방식 capturing에서 영역 안내가 보인다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId(FIXTURE_URL);
    const panel = await ext.openPanel(tabId);
    try {
      await expect(panel.getByTestId("tab-mode-area-hint")).toHaveCount(0);
      await panel.getByTestId("mode-screenshot").click();
      await expect(panel.getByTestId("capture-method-area")).toBeVisible();
      await expect(panel.getByTestId("tab-mode-area-hint")).toBeVisible();
      await panel.getByTestId("capturing-cancel").click();
      await expect(panel.getByTestId("tab-mode-area-hint")).toHaveCount(0);
    } finally {
      await panel.close();
      await fixture.close();
    }
  });
});
