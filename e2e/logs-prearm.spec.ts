import { enterDebug, expect, test } from "./fixtures/extension";

// pre-arm 버퍼링 — active origin(sessionStorage 플래그)에서 reload 시, 페이지 로드 초반
// (head/body, document_start ~ status:complete 전)에 발사된 marker fetch가 버퍼링됐다
// setSentinel에서 소급 flush된다. reload는 logClear → lastLogClearAt 경계를 세우지만, marker는
// 그보다 과거 타임스탬프여도 preArm 마커로 우회 보존돼야 한다. pre-arm이 없으면 status:complete
// 까지 recording=false라 로드 초반 fetch를 통째로 놓친다 → "reload 후 marker가 나타남" = pre-arm 작동.
// (전제: recorders-entry가 동기 IIFE라 후크가 페이지 inline script보다 먼저 설치됨 — log-throttle
//  공유를 끊어 crxjs가 loader 대신 IIFE를 emit. 이게 깨지면 head/body marker가 다시 안 잡힌다.)
test.describe.serial("logs pre-arm buffering", () => {
  test("active origin reload 시 로드 초반 marker fetch가 로그에 보존된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("prearm.html"));
    const tabId = await ext.fixtureTabId("http://127.0.0.1/prearm.html");
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-network").click();
    await expect(panel.getByTestId("subtab-network")).toHaveAttribute(
      "data-state",
      "active",
    );

    // 레코더 활성화(첫 setSentinel → setPreArmFlag) 대기 — 일반 fetch가 잡힐 때까지 polling.
    // 이 시점이면 sentinel이 발행돼 sessionStorage active 플래그가 세팅돼 있다.
    await expect(async () => {
      await fixture.evaluate(() => fetch("/e2e-arm-" + performance.now()).catch(() => {}));
      await panel.waitForTimeout(1700);
      await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // reload → 동기 IIFE 레코더가 pre-arm으로 로드 초반(head/body) marker를 버퍼링,
    // status:complete의 setSentinel에서 flush. reload의 logClear가 이전 로그(e2e-arm)를 비우지만,
    // marker는 preArm 마커로 lastLogClearAt 필터를 우회해 살아남아야 한다.
    await fixture.reload();

    await expect(
      panel.locator("[data-entry-id]", { hasText: "prearm-marker" }),
    ).not.toHaveCount(0, { timeout: 20_000 });

    await panel.close();
    await fixture.close();
  });

  // console pre-arm — 특히 error/warn은 일반 후킹(log/info/debug)과 달리 pre-arm일 때만
  // document_start에 설치(installEwWrap)된다. reload 후 로드 초반 error/warn이 레벨대로 잡혀야 한다.
  test("active origin reload 시 로드 초반 console.error/warn이 레벨대로 보존된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("prearm.html"));
    const tabId = await ext.fixtureTabId("http://127.0.0.1/prearm.html");
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-console").click();
    await expect(panel.getByTestId("subtab-console")).toHaveAttribute(
      "data-state",
      "active",
    );

    // 레코더 활성화(첫 setSentinel → setPreArmFlag) 대기.
    await expect(async () => {
      await fixture.evaluate(() => console.log("e2e-arm-" + performance.now()));
      await panel.waitForTimeout(1700);
      await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // reload → pre-arm으로 로드 초반 console.log/error/warn 버퍼링, setSentinel에서 flush.
    await fixture.reload();

    await expect(
      panel.locator('[data-entry-id][data-level="error"]', { hasText: "prearm-console-error" }),
    ).not.toHaveCount(0, { timeout: 20_000 });
    await expect(
      panel.locator('[data-entry-id][data-level="warn"]', { hasText: "prearm-console-warn" }),
    ).not.toHaveCount(0);
    await expect(
      panel.locator('[data-entry-id][data-level="log"]', { hasText: "prearm-console-log" }),
    ).not.toHaveCount(0);

    await panel.close();
    await fixture.close();
  });

  // action-recorder TDZ 회귀(v1.3.10 pre-arm) — active origin reload 시 document_start에서
  // capturing=true가 되면 init recordNavigation("load") → pushAction → throttle.schedule()이
  // throttle 선언 전(temporal dead zone)에 호출돼 "Cannot access 'throttle'/'z' before
  // initialization"이 매 로드마다 uncaught로 쌓였다. throttle 선언을 첫 pushAction 위로 hoist해
  // 해소. recorders-entry IIFE 안에서 action이 마지막 import라 console/network는 throw 전에 이미
  // 평가됨 → 위 두 test는 이 회귀를 못 잡는다. 페이지 uncaught error 부재로 직접 단언한다.
  test("active origin reload 시 recorders-entry가 TDZ 에러 없이 평가된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    const tdzErrors: string[] = [];
    fixture.on("pageerror", (err) => {
      if (/before initialization/i.test(err.message)) tdzErrors.push(err.message);
    });
    fixture.on("console", (msg) => {
      if (msg.type() === "error" && /before initialization/i.test(msg.text())) {
        tdzErrors.push(msg.text());
      }
    });

    await fixture.goto(ext.fixtureUrl("prearm.html"));
    const tabId = await ext.fixtureTabId("http://127.0.0.1/prearm.html");
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-console").click();

    // 레코더 활성화(첫 setSentinel → setPreArmFlag) 대기 — active origin 전제 확보.
    await expect(async () => {
      await fixture.evaluate(() => console.log("e2e-arm-" + performance.now()));
      await panel.waitForTimeout(1700);
      await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // reload → document_start에 capturing=true로 action 레코더 재평가. TDZ면 여기서 throw.
    await fixture.reload();
    await fixture.waitForLoadState("load");
    await panel.waitForTimeout(1000);

    expect(
      tdzErrors,
      `recorders-entry TDZ 회귀:\n${tdzErrors.join("\n")}`,
    ).toHaveLength(0);

    await panel.close();
    await fixture.close();
  });
});
