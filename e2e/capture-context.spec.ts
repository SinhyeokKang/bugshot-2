import {
  enterDebugAndPick,
  expect,
  test,
  typeStyleValue,
} from "./fixtures/extension";
import {
  assertGatesSatisfied,
  assertHypothesesSeparable,
  proceedToDrafting,
  settleBeforeCapture,
  snapshotAspect,
} from "./fixtures/capture-aspect";

const FIXTURE_URL = "http://127.0.0.1/capture-context.html";

test.describe("element 캡처 컨텍스트 확장", () => {
  test("모달 안 버튼을 편집하면 after 이미지가 다이얼로그 폭까지 확장된다", async ({
    ext,
  }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("capture-context.html"));
    const tabId = await ext.fixtureTabId(FIXTURE_URL);
    const panel = await ext.openPanel(tabId);

    await assertGatesSatisfied(fixture, "#modal", "#modal-btn");
    await enterDebugAndPick(fixture, panel, "#modal-btn", { keepFixtureActive: true });
    await settleBeforeCapture(fixture);
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(fixture.locator("#modal-btn")).toHaveCSS("color", "rgb(255, 0, 0)");

    await proceedToDrafting(panel, fixture);

    // 확장이 걸리면 크롭 기준이 버튼이 아니라 다이얼로그다.
    const { container } = await assertHypothesesSeparable(fixture, "#modal", "#modal-btn");
    // before까지 본다 — before가 유실되면 after는 조용히 요소 bbox로 떨어지므로,
    // 이 단언이 없으면 "구현 회귀"와 "before 캡처 실패"가 같은 실패로 보인다.
    expect(await snapshotAspect(panel, "before")).toBeCloseTo(container, 1);
    expect(await snapshotAspect(panel, "after")).toBeCloseTo(container, 1);

    await panel.close();
    await fixture.close();
  });

  test("시맨틱 컨테이너가 없으면 after 이미지가 요소 bbox로 폴백한다", async ({
    ext,
  }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("capture-context.html"));
    const tabId = await ext.fixtureTabId(FIXTURE_URL);
    const panel = await ext.openPanel(tabId);

    await enterDebugAndPick(fixture, panel, "#plain-btn", { keepFixtureActive: true });
    await settleBeforeCapture(fixture);
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(fixture.locator("#plain-btn")).toHaveCSS("color", "rgb(255, 0, 0)");

    await proceedToDrafting(panel, fixture);

    // div 체인은 후보가 아니므로 요소 bbox + 사방 마진에 머문다.
    // 대조군은 같은 페이지의 모달 — 확장이 잘못 걸렸다면 그쪽 종횡비가 나온다.
    const { element } = await assertHypothesesSeparable(fixture, "#modal", "#plain-btn");
    expect(await snapshotAspect(panel, "before")).toBeCloseTo(element, 1);
    expect(await snapshotAspect(panel, "after")).toBeCloseTo(element, 1);

    await panel.close();
    await fixture.close();
  });

  test("before 캡처가 날아가는 동안 [다음]이 잠기고, 완료 후 같은 컨테이너로 진행된다", async ({
    ext,
  }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("capture-context.html"));
    const tabId = await ext.fixtureTabId(FIXTURE_URL);
    const panel = await ext.openPanel(tabId);

    // 패널 컨텍스트의 chrome.tabs.sendMessage를 덮어 prepareCapture만 지연시킨다.
    // pick 이전에 깔아야 before 캡처를 잡는다. 지연을 안 걷으면 후속 캡처까지 느려진다.
    await panel.evaluate((delayMs) => {
      const tabs = chrome.tabs as unknown as {
        sendMessage: (...args: unknown[]) => Promise<unknown>;
      };
      const orig = tabs.sendMessage.bind(chrome.tabs);
      (window as unknown as { __restoreSend?: () => void }).__restoreSend = () => {
        tabs.sendMessage = orig;
      };
      tabs.sendMessage = (...args: unknown[]) => {
        const msg = args[1] as { type?: string } | undefined;
        if (msg?.type !== "picker.prepareCapture") return orig(...args);
        return new Promise((resolve) => {
          setTimeout(() => resolve(orig(...args)), delayMs);
        });
      };
    }, 6000);

    await assertGatesSatisfied(fixture, "#modal", "#modal-btn");
    await enterDebugAndPick(fixture, panel, "#modal-btn", { keepFixtureActive: true });
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(fixture.locator("#modal-btn")).toHaveCSS("color", "rgb(255, 0, 0)");

    // 편집이 끝나 hasChange는 참인데 before 캡처가 아직 in-flight — 잠겨 있어야 한다.
    const next = panel.getByTestId("next-step");
    await expect(next).toHaveAttribute("aria-disabled", "true");

    // 지연된 before 캡처는 지금부터 발화한다. 그 시점에 fixture 탭이 활성이어야 한다 —
    // typeStyleValue가 패널을 앞으로 가져왔고, 캡처 관문(captureOwnedTab)은 큐 대기 후
    // tab.active를 재확인하므로 그대로 두면 캡처가 거부돼 기준이 안 잡힌다(GOTCHAS "tab.active").
    await fixture.bringToFront();

    // 지연을 걷어야 after 캡처가 제때 돈다.
    await panel.evaluate(() =>
      (window as unknown as { __restoreSend?: () => void }).__restoreSend?.(),
    );

    // before가 도착하면 잠금이 풀린다.
    await expect(next).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });

    await proceedToDrafting(panel, fixture);

    // before가 확정한 기준(다이얼로그)으로 after도 찍힌다.
    const { container } = await assertHypothesesSeparable(fixture, "#modal", "#modal-btn");
    expect(await snapshotAspect(panel, "before")).toBeCloseTo(container, 1);
    expect(await snapshotAspect(panel, "after")).toBeCloseTo(container, 1);

    await panel.close();
    await fixture.close();
  });
});
