import { enterDebug, expect, test } from "./fixtures/extension";

// 네트워크 로그 검색어 하이라이트 — 상세 패널의 매칭 문구에 <mark data-testid="log-highlight">가 붙는지,
// 검색 해제 시 사라지는지, WebSocket messages 탭에는 새지 않는지(격리) 검증.
// 검색 200ms 디바운스는 toHaveCount의 자동 재시도(timeout)로 흡수한다.

test("response body 매칭이 하이라이트되고 검색 해제 시 사라진다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("subtab-network").click();
  await expect(panel.getByTestId("subtab-network")).toHaveAttribute("data-state", "active");

  // 본문에만 마커("zqxbodyneedle")를 담은 /e2e-json 요청 적재(레코더 활성 전 로그는 무시되므로 반복).
  await expect(async () => {
    const n = Date.now();
    await fixture.evaluate((t) => {
      void fetch("/e2e-json-" + t).catch(() => {});
    }, n);
    await panel.waitForTimeout(1700);
    await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });

  // 본문 마커로 검색 → 본문 매칭 행만 남는다(URL엔 마커 없음).
  await panel.getByTestId("network-search").fill("zqxbodyneedle");
  await expect(panel.locator("[data-entry-id]")).toHaveCount(1);

  // 해당 행 상세 열기 → response 탭.
  await panel.locator("[data-entry-id]").first().click();
  await panel.getByTestId("detail-tab-response").click();
  await expect(panel.getByTestId("detail-tab-response")).toHaveAttribute("data-state", "active");

  // 응답 본문 JSON 트리의 매칭 값이 하이라이트된다.
  const marks = panel.locator('mark[data-testid="log-highlight"]:visible');
  await expect(marks).not.toHaveCount(0);
  await expect(marks.first()).toHaveText("zqxbodyneedle");

  // 검색 해제 → 하이라이트 사라짐(디바운스 후).
  await panel.getByTestId("network-search").fill("");
  await expect(marks).toHaveCount(0);

  await panel.close();
  await fixture.close();
});

test("WebSocket messages 탭에는 하이라이트가 새지 않는다(격리)", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("websocket.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("subtab-network").click();
  await expect(panel.getByTestId("subtab-network")).toHaveAttribute("data-state", "active");

  // capturing 확인(warm-up) → clear → 이후 WS를 정확히 1회 잡는다.
  await expect(async () => {
    await fixture.evaluate(() => fetch("/e2e-warm-" + performance.now()).catch(() => {}));
    await panel.waitForTimeout(1700);
    await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });
  await panel.getByTestId("network-clear").click();
  await expect(panel.locator("[data-entry-id]")).toHaveCount(0);

  // ws url 호스트를 프레임 내용({"ping":"<host>"})과 검색어 양쪽에 실어,
  // 하이라이트가 messages로 새면 반드시 잡히도록 한다(host는 ws url에도 있어 검색 시 행 유지).
  const host = await fixture.evaluate(() => location.host);
  await fixture
    .evaluate((t: string) => (window as unknown as { __openWs: (x: string) => Promise<string> }).__openWs(t), host)
    .then(() => undefined, () => undefined);

  await expect(panel.locator('[data-ws="true"]')).toHaveCount(1, { timeout: 15_000 });
  await panel.locator('[data-ws="true"]').first().click();
  await expect(panel.getByTestId("detail-tab-messages")).toHaveAttribute("data-state", "active");

  // 송신 프레임 펼치기(FrameBody = JsonTreeViewer 렌더).
  await expect(panel.locator('[data-frame-direction="send"]')).not.toHaveCount(0);
  await panel.locator('[data-frame-direction="send"]').first().click();

  // host로 검색 → ws url(host 포함)이 매칭돼 상세 유지. debouncedQuery가 실제로 활성임을 확인:
  await panel.getByTestId("network-search").fill(host);
  const marks = panel.locator('mark[data-testid="log-highlight"]:visible');

  // headers 탭(숨김 아님·활성 시)에선 url의 host가 하이라이트된다 → 쿼리가 살아있음 증명.
  await panel.getByTestId("detail-tab-headers").click();
  await expect(marks).not.toHaveCount(0);

  // messages 탭으로 복귀 → FrameBody는 highlightQuery 미전달이라 보이는 하이라이트 0(격리).
  await panel.getByTestId("detail-tab-messages").click();
  await expect(panel.getByTestId("detail-tab-messages")).toHaveAttribute("data-state", "active");
  await expect(marks).toHaveCount(0);

  await panel.close();
  await fixture.close();
});
