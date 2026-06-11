import { enterDebug, expect, pickElement, test } from "./fixtures/extension";

// 캡처 모드 — screenshot(영역 드래그)·element-shot(요소 선택)이 captureVisibleTab(<all_urls>)을 거쳐
// drafting으로 진입하는지. video는 getUserMedia+tabCapture 의존이라 headed 자동화 불안정 → 수동 잔여.

test("screenshot 영역 캡처 → drafting 진입", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("mode-screenshot").click();

  // crosshair overlay(blocker) 위에서 드래그 — area-select는 mousedown→move→up,
  // 변(>10px)이어야 onSelected가 발화한다. steps로 mousemove를 여러 번 흘린다.
  await fixture.bringToFront();
  await fixture.mouse.move(60, 60);
  await fixture.mouse.down();
  await fixture.mouse.move(280, 220, { steps: 10 });
  await fixture.mouse.up();
  await panel.bringToFront();

  // areaSelected → captureVisibleTab → crop → onAreaCaptured → drafting.
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();

  await panel.close();
  await fixture.close();
});

test("element shot 캡처 → drafting 진입", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("mode-element-shot").click();

  // element-shot은 picker.start(요소 선택) → captureElementShot → onElementShot → drafting.
  await pickElement(fixture, panel, "#card");

  await expect(panel.getByTestId("drafting-panel")).toBeVisible();

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
  await panel.getByTestId("mode-element-shot").click();
  await pickElement(fixture, panel, "#card");
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();

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
