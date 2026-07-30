import type { Page } from "@playwright/test";

import {
  enterDebugAndPick,
  expect,
  test,
  typeStyleValue,
} from "./fixtures/extension";

const FIXTURE_URL = "http://127.0.0.1/capture-context.html";
// cropImage가 rect 사방에 붙이는 기본 마진(capture.ts DEFAULT_MARGIN).
const MARGIN = 24;

// after 이미지의 종횡비. 픽셀 폭을 CSS px로 환산하지 않는 이유: naturalWidth는
// captureVisibleTab이 실제 backing store 해상도로 찍은 값인데, Playwright는 페이지의
// devicePixelRatio를 1로 고정하므로 페이지에서 읽은 DPR로는 배율을 복원할 수 없다.
// 종횡비는 배율이 약분돼 사라지므로 "어느 rect로 잘랐나"를 배율 없이 판정한다.
async function snapshotAspect(
  panel: Page,
  which: "before" | "after",
): Promise<number> {
  const img = panel.getByTestId(`snapshot-${which}`);
  await expect(img).toBeVisible();
  return img.evaluate(async (el) => {
    const image = el as HTMLImageElement;
    await image.decode();
    return image.naturalWidth / image.naturalHeight;
  });
}

// 그 rect로 잘랐다면 나왔을 종횡비(사방 마진 포함).
async function expectedAspect(fixture: Page, selector: string): Promise<number> {
  return fixture.locator(selector).evaluate((el, margin) => {
    const r = el.getBoundingClientRect();
    return (r.width + margin * 2) / (r.height + margin * 2);
  }, MARGIN);
}

// 확장 가설과 폴백 가설이 실제로 구분되는지 먼저 확인한다. 픽스처 크기가 창 비율에
// 따라 두 종횡비를 가깝게 만들면 아래 단언이 통과해도 아무것도 증명하지 못한다.
async function assertHypothesesSeparable(
  fixture: Page,
  containerSelector: string,
  elementSelector: string,
): Promise<{ container: number; element: number }> {
  const container = await expectedAspect(fixture, containerSelector);
  const element = await expectedAspect(fixture, elementSelector);
  expect(Math.abs(container - element)).toBeGreaterThan(0.5);
  return { container, element };
}

// 픽스처가 확장 게이트 셋(G1 뷰포트 완전 포함 / G2 요소 완전 포함 / G3 면적 40% 이하)을
// 실제로 만족하는지 확인한다. 하나라도 깨지면 제품은 정상적으로 폴백하므로, 이 단언이
// 없으면 "확장이 안 걸렸다"가 구현 회귀인지 픽스처 붕괴인지 구별되지 않는다.
// (모달 높이가 내용보다 작아 버튼이 박스 밖으로 나가 G2가 깨진 전례가 있다.)
async function assertGatesSatisfied(
  fixture: Page,
  containerSelector: string,
  elementSelector: string,
): Promise<void> {
  const gates = await fixture.evaluate(
    ([containerSel, elementSel]) => {
      const c = document.querySelector(containerSel)!.getBoundingClientRect();
      const e = document.querySelector(elementSel)!.getBoundingClientRect();
      return {
        withinViewport:
          c.x >= 0 &&
          c.y >= 0 &&
          c.x + c.width <= window.innerWidth &&
          c.y + c.height <= window.innerHeight,
        containsElement:
          e.x >= c.x &&
          e.y >= c.y &&
          e.x + e.width <= c.x + c.width &&
          e.y + e.height <= c.y + c.height,
        areaRatio: (c.width * c.height) / (window.innerWidth * window.innerHeight),
      };
    },
    [containerSelector, elementSelector],
  );
  expect(gates.withinViewport).toBe(true);
  expect(gates.containsElement).toBe(true);
  expect(gates.areaRatio).toBeLessThanOrEqual(0.4);
}

// pick 직후 발행되는 **before 캡처**가 background 직렬 큐에서 빠져나올 때까지 fixture를 앞에 둔다.
// 이걸 안 하면 typeStyleValue가 패널을 앞으로 가져오고, 큐가 그 캡처에 도달했을 때
// captureOwnedTab의 tab.active 재확인에서 거부된다 — before 기준이 저장되지 않아 after만
// 요소 bbox로 폴백하고, 증상은 "확장이 안 걸림"으로만 보인다. after 캡처와 달리 before는
// 재시도 지점이 없어서 여기서 한 번 놓치면 그대로 끝난다.
// 대기는 timeout 늘리기가 아니라 캡처 큐·quota 주기(~500ms 간격 + 백오프)에 맞춘 간격이다.
async function settleBeforeCapture(fixture: Page): Promise<void> {
  await fixture.bringToFront();
  await fixture.waitForTimeout(1500);
}

// [다음]은 aria-disabled+클릭 가드라 actionability가 막지 않는다 — 부재 단언이 필수.
// 캡처 관문(captureOwnedTab)이 tab.active를 재확인하므로 fixture를 앞에 두고 evaluate 클릭한다.
async function proceedToDrafting(panel: Page, fixture: Page): Promise<void> {
  const next = panel.getByTestId("next-step");
  const drafting = panel.getByTestId("drafting-panel");
  // captureVisibleTab quota(~2회/초)는 확장 전역이라 spec 경계를 넘는다 — 버스트 금지,
  // 1초 이상 간격으로 재시도한다(captureUntilDrafting 관례).
  await expect(async () => {
    if (!(await drafting.isVisible())) {
      await expect(next).not.toHaveAttribute("aria-disabled", "true");
      await fixture.bringToFront();
      await next.evaluate((el) => (el as HTMLElement).click());
    }
    await expect(drafting).toBeVisible({ timeout: 2500 });
  }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 25_000 });
}

test.describe("element 캡처 컨텍스트 확장", () => {
  test("모달 안 버튼을 편집하면 after 이미지가 다이얼로그 폭까지 확장된다", async ({
    ext,
  }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("capture-context.html"));
    const tabId = await ext.fixtureTabId(FIXTURE_URL);
    const panel = await ext.openPanel(tabId);

    await assertGatesSatisfied(fixture, "#modal", "#modal-btn");
    await enterDebugAndPick(fixture, panel, "#modal-btn");
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

    await enterDebugAndPick(fixture, panel, "#plain-btn");
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
    await enterDebugAndPick(fixture, panel, "#modal-btn");
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
