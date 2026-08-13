import { enterDebug, expect, test } from "./fixtures/extension";

// 패널이 열리면 useBackgroundRecorder가 console/network 레코더를 자동 주입(sentinel 발행)한다.
// 활성화 완료 신호가 없어, 로그 발생 + sync 주기(1500ms) 대기를 polling으로 반복해
// 첫 캡처가 잡힐 때까지 기다린다. action 로그는 video 모드 종속 뷰라 여기서 다루지 않는다(수동 잔여).
// origin 필터·cross-page 누적·iframe 캡처는 logs-*.spec.ts에서 별도 커버.
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

  test("network 요청 수집 → 상세 status 표시 → clear", async ({ ext }) => {
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

    // 상세 — fixture 서버는 /e2e-ping-*에 404를 주므로 완료 후 status가 표시돼야 한다.
    await panel.locator("[data-entry-id]").first().click();
    await expect(panel.getByText(/404/).first()).toBeVisible();

    // clear → 비움 (console-clear와 대칭).
    await panel.getByTestId("network-clear").click();
    await expect(panel.locator("[data-entry-id]")).toHaveCount(0);

    await panel.close();
    await fixture.close();
  });

  // BugShot이 만든 상태 라벨(Queued·Aborted·Network Error …)은 statusText 데이터 필드에 영문으로
  // 남고 UI만 statusKind로 번역한다. **라벨 텍스트로 단언하지 않는다** — 앱 locale이 비결정이라
  // (GOTCHAS "locale 비결정") ko/en 어느 쪽이 뜰지 모른다. 대신 번역 실패 시에만 나타나는
  // `${status} ${statusText}` 원문 형태의 부재로 판정한다: ko "큐에 등록됨" / en "Queued" 둘 다
  // "0 Queued"를 포함하지 않고, statusKind를 지우면 정확히 그 문자열로 되돌아간다.
  test("sendBeacon 상태가 원문 '0 Queued'가 아니라 번역 라벨로 표시된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-network").click();
    await expect(panel.getByTestId("subtab-network")).toHaveAttribute("data-state", "active");

    // sendBeacon 후크도 fetch·XHR과 같은 construct-time `capturing` 게이트를 탄다 — arm 전에
    // 쏘면 조용히 유실되므로, 경로 마커가 행으로 잡힐 때까지 재시도한다(행 본문은 pathname뿐).
    await expect(async () => {
      await fixture.evaluate(() => {
        navigator.sendBeacon("/e2e-json-beacon", "ping");
      });
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator("[data-entry-id]").filter({ hasText: "/e2e-json-beacon" }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    await panel.locator("[data-entry-id]").filter({ hasText: "/e2e-json-beacon" }).first().click();
    const status = panel.getByTestId("network-status-value");
    await expect(status).toBeVisible();
    await expect(status).not.toContainText("0 Queued");
    // 큐 성공은 phase complete라 blocked 분기로 새지 않는다(statusKind 오배선 가드).
    await expect(panel.getByTestId("network-status-hint")).toHaveCount(0);

    await panel.getByTestId("network-clear").click();
    await panel.close();
    await fixture.close();
  });

  // 항목 31 회귀 — statusKind:"networkError"가 isStatusHidden을 통과해 blocked 문구 + 힌트로 가야
  // 한다. fetch가 아니라 XHR을 쓰는 이유: CORS 실패 fetch는 `TypeError: Failed to fetch`(Error)라
  // 설계상 statusKind를 안 받고 지금도 blocked 대상이 아니다(design.md 회귀 감시 7). XHR error만
  // "Network Error" + networkError를 만든다.
  test("CORS 차단 XHR은 '실패 · 상태 가려짐' + 힌트로 표시된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    // 같은 fixture 서버를 다른 호스트명으로 — 서버가 CORS 헤더를 안 주므로 cross-origin XHR은
    // error 이벤트로 떨어진다(127.0.0.1 top vs localhost, cross-origin.html과 같은 트릭).
    const crossUrl = ext.fixtureUrl("basic.html").replace("127.0.0.1", "localhost");

    await enterDebug(panel);
    await panel.getByTestId("subtab-network").click();
    await expect(panel.getByTestId("subtab-network")).toHaveAttribute("data-state", "active");

    await expect(async () => {
      await fixture.evaluate((url) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.send();
      }, crossUrl);
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator("[data-entry-id]").filter({ hasText: "/basic.html" }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    await panel.locator("[data-entry-id]").filter({ hasText: "/basic.html" }).first().click();
    const status = panel.getByTestId("network-status-value");
    await expect(status).toBeVisible();
    // 이 spec이 무는 축은 "statusKind:networkError가 blocked 분기에 도달한다"까지다. statusKind
    // 우선 판정을 지워도 statusText 폴백이 같은 답을 내 green이다(뮤턴트로 실측) — 그 축의 판별은
    // network-status.test.ts의 statusKind 유무 쌍이 담당한다.
    await expect(panel.getByTestId("network-status-hint")).toBeVisible();
    await expect(status).not.toContainText("0 Network Error");

    await panel.getByTestId("network-clear").click();
    await panel.close();
    await fixture.close();
  });
});
