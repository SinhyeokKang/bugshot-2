import { enterDebug, expect, test, type ExtContext } from "./fixtures/extension";
import type { Page } from "@playwright/test";

// WebSocket 프레임 캡처 — 연결=네트워크 행(status 101) + 상세 Messages 탭(send/receive/open 프레임).
// fixture 서버가 raw ws echo를 제공(extension.ts upgrade 핸들). 레코더가 window.WebSocket을
// 후킹한 뒤 연결돼야 잡히므로, capturing 확인(warm-up fetch) → clear → __openWs로 한 번만 연다.
test.describe.serial("websocket log", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }: { ext: ExtContext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("websocket.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
    await panel.getByTestId("subtab-network").click();
    await expect(panel.getByTestId("subtab-network")).toHaveAttribute(
      "data-state",
      "active",
    );
  });

  test.afterAll(async () => {
    await panel?.close();
    await fixture?.close();
  });

  // capturing이 켜졌는지 fetch 1건으로 확인 후 clear → 뒤이어 여는 WS를 정확히 잡도록 보장.
  async function warmUpAndClear() {
    await expect(async () => {
      await fixture.evaluate(() =>
        fetch("/e2e-warm-" + performance.now()).catch(() => {}),
      );
      await panel.waitForTimeout(1700);
      await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });
    await panel.getByTestId("network-clear").click();
    await expect(panel.locator("[data-entry-id]")).toHaveCount(0);
  }

  function openWs(tag: string): Promise<void> {
    return fixture
      .evaluate(
        (t: string) =>
          (window as unknown as { __openWs: (x: string) => Promise<string> }).__openWs(t),
        tag,
      )
      .then(
        () => undefined,
        () => undefined,
      );
  }

  test("WS 연결이 status 101 행 + Messages 탭에 send/receive 프레임", async () => {
    await warmUpAndClear();
    await openWs("first");

    await expect(panel.locator('[data-ws="true"]')).toHaveCount(1, {
      timeout: 15_000,
    });
    await panel.locator('[data-ws="true"]').first().click();

    // WS 행 클릭 시 상세가 Messages 탭으로 바로 열린다.
    await expect(panel.getByTestId("detail-tab-messages")).toHaveAttribute(
      "data-state",
      "active",
    );

    // 송신·수신 프레임이 시간순으로 잡힌다(echo 받았으므로 receive 존재).
    await expect(panel.locator('[data-frame-direction="send"]')).not.toHaveCount(0);
    await expect(panel.locator('[data-frame-direction="receive"]')).not.toHaveCount(0);

    // 연결을 닫으면 close 프레임 + phase complete → General에 핸드셰이크 status 101 노출
    // (열린 동안은 pending이라 "응답 대기 중"으로 표시됨).
    await fixture.evaluate(() =>
      (window as unknown as { __closeWs: () => void }).__closeWs(),
    );
    await expect(panel.locator('[data-frame-direction="close"]')).toHaveCount(1, {
      timeout: 15_000,
    });

    // Headers 탭에서 status 101("101"은 i18n 무관 리터럴).
    await panel.getByTestId("detail-tab-headers").click();
    await expect(panel.getByText(/101/).first()).toBeVisible();
  });

  test("Send 필터 → receive 데이터 프레임 숨김, send + open 유지", async () => {
    await warmUpAndClear();
    await openWs("filter");

    await expect(panel.locator('[data-ws="true"]')).toHaveCount(1, {
      timeout: 15_000,
    });
    await panel.locator('[data-ws="true"]').first().click();
    await expect(panel.getByTestId("detail-tab-messages")).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(panel.locator('[data-frame-direction="receive"]')).not.toHaveCount(0);

    await panel.locator('[data-testid="ws-dir-filter"][data-dir="send"]').click();
    await expect(panel.locator('[data-frame-direction="receive"]')).toHaveCount(0);
    await expect(panel.locator('[data-frame-direction="send"]')).not.toHaveCount(0);
    // open 이벤트 행은 방향 필터와 무관하게 유지.
    await expect(panel.locator('[data-frame-direction="open"]')).toHaveCount(1);
  });

  test("무간섭 — 후킹 후에도 정적 상수·instanceof·생성자 유지", async () => {
    const ok = await fixture.evaluate(() =>
      (window as unknown as { __wsCheck: () => boolean }).__wsCheck(),
    );
    expect(ok).toBe(true);
  });

  test("동시 다중 연결 → 행이 연결 수만큼 분리", async () => {
    await warmUpAndClear();
    await openWs("conn-a");
    await openWs("conn-b");

    await expect(panel.locator('[data-ws="true"]')).toHaveCount(2, {
      timeout: 15_000,
    });
  });
});
