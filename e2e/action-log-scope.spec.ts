import type { Page } from "@playwright/test";
import { enterDebug, enterDebugAndPick, expect, test, typeStyleValue } from "./fixtures/extension";

// 액션 로그 스코프 — v1.5.8에서 video 전용에서 console/network와 동일 스코프로 확장됐다
// (screenshot·freeform·video 지원, element만 제외 — supportsActionLog).
// 이전엔 액션 로그 UI가 video drafting에만 있어 e2e로 못 잡았고, 그게 COVERAGE의 제외 사유였다.
// 이제 스크린샷 경로로 카드·토글·기록 내용을 전부 검증할 수 있다(video 녹화는 tabCapture라 여전히 어렵다).

// captureVisibleTab rate-limit(~2회/초)는 확장 전역이라 quota 회복 재시도가 필요(download-buttons와 동일).
async function captureScreenshotUntilDrafting(fixture: Page, panel: Page): Promise<void> {
  const drafting = panel.getByTestId("drafting-panel");
  await expect(async () => {
    if (!(await drafting.isVisible())) {
      await panel.getByTestId("mode-screenshot").click();
      await fixture.bringToFront();
      await fixture.mouse.move(60, 60);
      await fixture.mouse.down();
      await fixture.mouse.move(280, 220, { steps: 10 });
      await fixture.mouse.up();
      await panel.bringToFront();
    }
    await expect(drafting).toBeVisible({ timeout: 2500 });
  }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 25_000 });
}

// 액션 로그는 idle에 전용 서브탭이 없어(DebugTab은 issue/console/network뿐) store 적재를 직접 볼 수 없다.
// 액션·콘솔은 같은 레코더 파이프라인·같은 sync 주기라, 콘솔 항목이 잡히면 그 사이 발생시킨 클릭도 적재된다.
// 콘솔 항목을 관측 가능한 프록시로 삼아 polling한다(log-capture 패턴).
async function seedActionAndConsoleLogs(fixture: Page, panel: Page): Promise<void> {
  await panel.getByTestId("subtab-console").click();
  await expect(panel.getByTestId("subtab-console")).toHaveAttribute("data-state", "active");
  await expect(async () => {
    // 클릭을 페이지 안에서 디스패치한다 — bringToFront 왕복으로 패널을 백그라운드로 보내면
    // 패널이 hidden이 되어 sync가 밀린다. 액션 레코더는 capture-phase 리스너라 합성 클릭도 잡는다.
    await fixture.evaluate(() => {
      document.querySelector<HTMLElement>("#title")?.click();
      document.querySelector<HTMLElement>("#card")?.click();
      console.log("bugshot-e2e-actionscope", performance.now());
    });
    await panel.waitForTimeout(1700);
    await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });
}

test.describe.serial("action log scope", () => {
  test("스크린샷 캡처 — 액션 로그 카드 노출·기본 첨부 ON·기록 내용 확인", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await seedActionAndConsoleLogs(fixture, panel);

    // console 서브탭에서 캡처 진입 화면으로 복귀해야 mode-screenshot이 보인다(GOTCHAS).
    await panel.getByTestId("subtab-issue").click();
    await captureScreenshotUntilDrafting(fixture, panel);

    // 확장 전(video 전용)이면 여기서 카드가 아예 없었다.
    const card = panel.getByTestId("action-log-card");
    await expect(card).toBeVisible();

    // 진입 액션(startCapturing)이 3종 토글을 일괄 true로 세팅 — 액션도 기본 첨부.
    await expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    // 카드를 열면 idle에서 발생시킨 클릭이 기록돼 있어야 한다.
    await card.click();
    const dialog = panel.getByTestId("action-log-preview-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-entry-id]")).not.toHaveCount(0);
    await panel.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await panel.close();
    await fixture.close();
  });

  test("액션 첨부 토글 OFF → preview에서 액션 카드 제외 (콘솔 카드는 유지)", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await seedActionAndConsoleLogs(fixture, panel);

    await panel.getByTestId("subtab-issue").click();
    await captureScreenshotUntilDrafting(fixture, panel);

    // 액션만 끈다 — 콘솔은 켜둔 채라 "액션만 빠졌다"를 대조로 판정할 수 있다.
    const card = panel.getByTestId("action-log-card");
    await card.getByRole("switch").click();
    await expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    // PreviewPanel은 attach 토글까지 반영해 "제출될 것만" 보여준다.
    await panel.getByTestId("draft-title").fill("Action log toggle e2e");
    await panel.getByTestId("to-preview").click();
    await expect(panel.getByTestId("copy-markdown")).toBeVisible();

    await expect(panel.getByTestId("action-log-card")).toHaveCount(0);
    await expect(panel.getByTestId("console-log-card")).toBeVisible();

    await panel.close();
    await fixture.close();
  });

  test("element 모드 — 액션 로그 카드 없음 (로그 전무 회귀 가드)", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebugAndPick(fixture, panel, "#title");
    await typeStyleValue(panel, "color", "#ff0000");

    const next = panel.getByTestId("next-step");
    await expect(next).not.toHaveAttribute("aria-disabled", "true");
    await next.click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();

    // element는 세 로그 전부 미지원 — 액션만이 아니라 카드 자체가 없어야 한다.
    await expect(panel.getByTestId("action-log-card")).toHaveCount(0);
    await expect(panel.getByTestId("console-log-card")).toHaveCount(0);

    await panel.close();
    await fixture.close();
  });
});
