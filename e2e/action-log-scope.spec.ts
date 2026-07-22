import type { Page } from "@playwright/test";
import { enterDebug, enterDebugAndPick, expect, test, typeStyleValue } from "./fixtures/extension";

// 로그 첨부 단일 토글 — 타입별 3카드/3다이얼로그가 단일 카드(`log-attachment-card`) +
// 탭형 단일 다이얼로그(`log-preview-dialog`, console/network/action 3탭 고정)로 통합됐다.
// 첨부는 통짜 토글(`logsAttach`) 하나. 여기서 카드 노출·기본 ON·탭 다이얼로그·[첨부 해제]·
// preview 미노출·element 부재를 스크린샷 경로로 검증한다(video 녹화는 tabCapture라 수동 잔여).

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

// 로그 카드는 store에 캡처된 로그(captured>0)가 있어야 뜬다. 액션은 idle 전용 서브탭이 없어
// (DebugTab은 issue/console/network뿐) 같은 레코더·같은 sync 주기인 콘솔 항목을 프록시로 polling.
// 콘솔·액션을 함께 적재해 캡처 후 drafting에 카드가 뜨도록 시드한다(log-capture 패턴).
async function seedActionAndConsoleLogs(fixture: Page, panel: Page): Promise<void> {
  await panel.getByTestId("subtab-console").click();
  await expect(panel.getByTestId("subtab-console")).toHaveAttribute("data-state", "active");
  await expect(async () => {
    // 클릭을 페이지 안에서 디스패치 — bringToFront 왕복으로 패널이 hidden이 되면 sync가 밀린다.
    await fixture.evaluate(() => {
      document.querySelector<HTMLElement>("#title")?.click();
      document.querySelector<HTMLElement>("#card")?.click();
      console.log("bugshot-e2e-actionscope", performance.now());
    });
    await panel.waitForTimeout(1700);
    await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });
}

test.describe.serial("log attachment single toggle", () => {
  test("스크린샷 캡처 — 단일 카드·기본 ON·3탭 다이얼로그·[첨부 해제]로 OFF", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await seedActionAndConsoleLogs(fixture, panel);

    // console 서브탭에서 캡처 진입 화면으로 복귀해야 mode-screenshot이 보인다(GOTCHAS).
    await panel.getByTestId("subtab-issue").click();
    await captureScreenshotUntilDrafting(fixture, panel);

    // 로그 카드는 정확히 1개(타입별 3카드 → 단일 카드).
    const card = panel.getByTestId("log-attachment-card");
    await expect(card).toHaveCount(1);
    // 진입 액션(startCapturing)이 logsAttach를 true로 세팅 — 기본 첨부 ON.
    await expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    // 카드 클릭 → 탭형 다이얼로그. console/network/action 3탭이 항상 노출(0건도 활성 — 정책 통일).
    await card.click();
    const dialog = panel.getByTestId("log-preview-dialog");
    await expect(dialog).toBeVisible();
    await expect(panel.getByTestId("log-preview-tab-console")).toBeVisible();
    await expect(panel.getByTestId("log-preview-tab-network")).toBeVisible();
    await expect(panel.getByTestId("log-preview-tab-action")).toBeVisible();

    // 시드한 액션이 action 탭에 기록돼 있어야 한다(활성 탭만 visible이라 :visible로 스코프).
    await panel.getByTestId("log-preview-tab-action").click();
    await expect(dialog.locator("[data-entry-id]:visible")).not.toHaveCount(0);
    await panel.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // 다시 열어 푸터 [첨부 해제] → 스위치 OFF + 다이얼로그 닫힘.
    await card.click();
    await expect(dialog).toBeVisible();
    await panel.getByTestId("log-preview-toggle-attach").click();
    await expect(dialog).toBeHidden();
    await expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    await panel.close();
    await fixture.close();
  });

  test("카드 스위치 OFF → preview에서 로그 카드 미노출 (logs 미첨부)", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await seedActionAndConsoleLogs(fixture, panel);

    await panel.getByTestId("subtab-issue").click();
    await captureScreenshotUntilDrafting(fixture, panel);

    const card = panel.getByTestId("log-attachment-card");
    await card.getByRole("switch").click();
    await expect(card.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    // PreviewPanel은 통짜 게이트라 off면 "제출될 것" 로그가 없어 카드가 아예 안 뜬다.
    await panel.getByTestId("draft-title").fill("Log toggle e2e");
    await panel.getByTestId("to-preview").click();
    await expect(panel.getByTestId("copy-markdown")).toBeVisible();

    await expect(panel.getByTestId("log-attachment-card")).toHaveCount(0);

    await panel.close();
    await fixture.close();
  });

  test("element 모드 — 로그 카드 없음 (로그 전무 회귀 가드)", async ({ ext }) => {
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

    // element는 세 로그 전부 미지원(표시·첨부 게이트) — 카드 자체가 없어야 한다.
    await expect(panel.getByTestId("log-attachment-card")).toHaveCount(0);

    await panel.close();
    await fixture.close();
  });
});
