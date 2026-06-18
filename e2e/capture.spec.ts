import type { Page } from "@playwright/test";
import { enterDebug, expect, pickElement, test } from "./fixtures/extension";

// 캡처 모드 — screenshot(영역 드래그)·element-shot(요소 선택)이 captureVisibleTab(<all_urls>)을 거쳐
// drafting으로 진입하는지. video는 getUserMedia+tabCapture 의존이라 headed 자동화 불안정 → 수동 잔여.

// captureVisibleTab은 Chrome rate-limit(MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND, ~2회/초)이 걸린다.
// full-suite에서 선행 캡처 spec(action-log-coverage·replay-action-log의 Replay 폴링)이 quota를
// 소진한 직후 이 spec이 돌면 captureVisibleTab이 reject → captureAndCrop이 reset()해 panel이
// idle("Choose capture mode")로 복귀, drafting이 안 뜬다(full-suite 부하 flake). 제품은 캡처 실패
// 시 사용자가 재시도하는 게 정상이므로, 트리거(mode+선택)를 drafting 진입까지 1초+ 간격으로
// 재시도해 quota 회복을 기다린다(타이밍 원인 제거 — timeout 늘리기/retry 남발 아님).
async function captureUntilDrafting(panel: Page, trigger: () => Promise<void>): Promise<void> {
  const drafting = panel.getByTestId("drafting-panel");
  await expect(async () => {
    // 이미 진입했으면 재트리거 금지(직전 시도가 느리게 성공한 경우 mode 버튼 재클릭 방지).
    if (!(await drafting.isVisible())) await trigger();
    await expect(drafting).toBeVisible({ timeout: 2500 });
  }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 25_000 });
}

test("screenshot 영역 캡처 → drafting 진입", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);

  // areaSelected → captureVisibleTab → crop → onAreaCaptured → drafting.
  await captureUntilDrafting(panel, async () => {
    await panel.getByTestId("mode-screenshot").click();
    // crosshair overlay(blocker) 위에서 드래그 — area-select는 mousedown→move→up,
    // 변(>10px)이어야 onSelected가 발화한다. steps로 mousemove를 여러 번 흘린다.
    await fixture.bringToFront();
    await fixture.mouse.move(60, 60);
    await fixture.mouse.down();
    await fixture.mouse.move(280, 220, { steps: 10 });
    await fixture.mouse.up();
    await panel.bringToFront();
  });

  await panel.close();
  await fixture.close();
});

test("element shot 캡처 → drafting 진입", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);

  // element-shot은 picker.start(요소 선택) → captureElementShot → onElementShot → drafting.
  await captureUntilDrafting(panel, async () => {
    await panel.getByTestId("mode-element-shot").click();
    await pickElement(fixture, panel, "#card");
  });

  await panel.close();
  await fixture.close();
});

// 회귀: element-shot은 captureMode="screenshot"이라 PreviewPanel env가 element 분기로 안 들어와
// shotSelector 기반 DOM 행이 누락됐다(drafting·제출 본문엔 있었음). previewing에서 DOM 행 확인.
test("element shot 캡처 → previewing env에 DOM 행", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);

  await captureUntilDrafting(panel, async () => {
    await panel.getByTestId("mode-element-shot").click();
    await pickElement(fixture, panel, "#card");
  });

  // 제목 입력 후 previewing 진입
  await panel.getByTestId("draft-title").fill("Element shot bug");
  await panel.getByTestId("to-preview").click();

  // previewing env에 DOM 행이 있어야 한다 (회귀 전엔 element-shot이 else로 빠져 누락)
  const previewDom = panel.locator(
    '[data-testid="env-row"][data-env-label="DOM"]',
  );
  await expect(previewDom).toHaveCount(1);
  await expect(previewDom).toContainText("card");

  await panel.close();
  await fixture.close();
});
