import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 미디어·로그 섹션 다운로드 버튼 — drafting/preview에서 download 버튼 클릭이 올바른 파일명으로
// 다운로드를 발화하는지. blob URL `<a download>`라 Playwright download 이벤트로 판정 가능.
// 파일 내용(스크린샷 픽셀·바이너리)은 판정 불가 — 트리거+파일명까지가 스크립트 한계.
// video 미디어 다운로드(recording.mp4)는 Replay 경로라 replay-action-log.spec이 커버.

// captureVisibleTab rate-limit(~2회/초)는 확장 전역이라 full-suite에서 quota 회복을 기다리는
// 재시도가 필요(capture.spec와 동일 함정). 트리거를 drafting 진입까지 1초+ 간격 toPass.
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

async function expectDownload(panel: Page, testId: string, filename: string): Promise<void> {
  const [download] = await Promise.all([
    panel.waitForEvent("download"),
    panel.getByTestId(testId).click(),
  ]);
  expect(download.suggestedFilename()).toBe(filename);
}

test("스크린샷 미디어 다운로드 — drafting·preview에서 screenshot.webp", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await captureScreenshotUntilDrafting(fixture, panel);

  // drafting 미디어 섹션 다운로드
  await expectDownload(panel, "download-media", "screenshot.webp");

  // previewing 진입 후 미디어 섹션 다운로드
  await panel.getByTestId("draft-title").fill("Screenshot download e2e");
  await panel.getByTestId("to-preview").click();
  await expect(panel.getByTestId("copy-markdown")).toBeVisible();
  await expectDownload(panel, "download-media", "screenshot.webp");

  await panel.close();
  await fixture.close();
});

test("로그 섹션 다운로드 — drafting에서 logs.html", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);

  // idle에서 console·network 로그를 수집해 store에 적재 — drafting 로그 카드 노출 전제.
  // 레코더 활성화 전 로그는 무시되므로 항목이 잡힐 때까지 발생+sync(1700ms) 반복(log-capture 패턴).
  await panel.getByTestId("subtab-console").click();
  await expect(async () => {
    await fixture.evaluate(() => {
      console.log("bugshot-e2e-logdl", performance.now());
      fetch("/e2e-logdl-" + performance.now()).catch(() => {});
    });
    await panel.waitForTimeout(1700);
    await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });

  // 로그 적재된 상태로 스크린샷 캡처 → drafting. console 서브탭에서 issue(캡처 진입)로 복귀해야
  // mode-screenshot이 보인다. 로그 카드 섹션이 노출돼야 한다.
  await panel.getByTestId("subtab-issue").click();
  await captureScreenshotUntilDrafting(fixture, panel);
  await expect(panel.getByTestId("download-logs")).toBeVisible();
  await expectDownload(panel, "download-logs", "logs.html");

  await panel.close();
  await fixture.close();
});
