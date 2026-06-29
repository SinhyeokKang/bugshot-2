import { enterDebug, expect, test } from "./fixtures/extension";

// 네트워크 로그 검색이 URL뿐 아니라 응답 본문까지 매칭하는지 검증.
// fixture 서버의 /e2e-json* 엔드포인트는 본문에만 마커("zqxbodyneedle")를 담은 JSON을 준다
// — 마커는 URL 경로엔 없으므로, 마커로 검색해 해당 행만 남으면 "본문 매칭"이 입증된다.
// 검색 input은 200ms 디바운스라 toHaveCount의 자동 재시도(timeout)로 흡수한다.
test("network log search matches response body, not just URL", async ({ ext }) => {
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

  // 본문에 마커가 있는 요청(/e2e-json) + 마커 없는 노이즈 요청(/e2e-noise, 404)을 둘 다 적재.
  // 레코더 활성화 전 로그는 무시되므로 발생 + sync 대기를 두 항목이 잡힐 때까지 반복.
  await expect(async () => {
    const n = Date.now();
    await fixture.evaluate((t) => {
      void fetch("/e2e-json-" + t).catch(() => {});
      void fetch("/e2e-noise-" + t).catch(() => {});
    }, n);
    await panel.waitForTimeout(1700);
    await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });

  // 마커는 어느 URL 경로에도 없다(본문에만 존재). 검색 전 전체 목록엔 2건 이상.
  await expect(panel.locator("[data-entry-id]").filter({ hasText: "zqxbodyneedle" })).toHaveCount(0);

  // 본문 마커로 검색 → 본문에 마커를 담은 /e2e-json 행만 남는다(디바운스 후).
  await panel.getByTestId("network-search").fill("zqxbodyneedle");
  await expect(panel.locator("[data-entry-id]")).toHaveCount(1);
  await expect(panel.locator("[data-entry-id]").first()).toContainText("e2e-json");

  // 검색 해제 → 다시 여러 건(디바운스 후).
  await panel.getByTestId("network-search").fill("");
  await expect
    .poll(() => panel.locator("[data-entry-id]").count())
    .toBeGreaterThan(1);

  await panel.close();
  await fixture.close();
});
