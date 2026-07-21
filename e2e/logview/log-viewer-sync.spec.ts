import { test, expect, type Page } from "@playwright/test";
import {
  openViewer,
  makeConsoleLog,
  makeNetworkLog,
  makeActionLog,
  generateTinyVideoDataUrl,
  T0,
} from "./fixtures";

// video + 3종 로그를 주입해 연다. 영상 startedAt=T0라 T0+ms 로그가 (ms/1000)초로 매핑된다.
async function openWithVideo(page: Page): Promise<void> {
  const dataUrl = await generateTinyVideoDataUrl(page);
  await openViewer(page, {
    video: { dataUrl, startedAt: T0 },
    consoleLog: makeConsoleLog(),
    networkLog: makeNetworkLog(),
    actionLog: makeActionLog(),
  });
  // seek 검증이 재생 진행에 흔들리지 않게 정지 상태로 고정.
  await page.locator("video").waitFor();
  await page.$eval("video", (v: HTMLVideoElement) => v.pause());
}

function currentTime(page: Page): Promise<number> {
  return page.$eval("video", (v: HTMLVideoElement) => v.currentTime);
}

test.describe("log-viewer 영상↔로그 sync", () => {
  test("타임라인 마커가 3타입 통합 렌더 (활성 탭 무관)", async ({ page }) => {
    await openWithVideo(page);

    // 기본 탭은 console인데도 세 타입 마커가 함께 뜬다(활성탭 필터 폐기 → buildErrorMarkers 통합).
    await expect(page.getByTestId("logview-tab-console")).toHaveAttribute("data-state", "active");
    await expect(page.locator('[data-testid="timeline-marker"][data-marker-type="console"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="timeline-marker"][data-marker-type="network"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="timeline-marker"][data-marker-type="action"]').first()).toBeVisible();
  });

  test("마커 클릭 → 해당 타입 탭으로 전환", async ({ page }) => {
    await openWithVideo(page);
    await expect(page.getByTestId("logview-tab-console")).toHaveAttribute("data-state", "active");

    // console 탭 상태에서 network 마커 클릭 → network 탭으로 전환.
    await page.locator('[data-testid="timeline-marker"][data-marker-type="network"]').first().click();
    await expect(page.getByTestId("logview-tab-network")).toHaveAttribute("data-state", "active");

    // action 마커 클릭 → action 탭으로 전환.
    await page.locator('[data-testid="timeline-marker"][data-marker-type="action"]').first().click();
    await expect(page.getByTestId("logview-tab-action")).toHaveAttribute("data-state", "active");
  });

  test("로그 행 클릭 → 영상이 해당 로그 시각으로 시크", async ({ page }) => {
    await openWithVideo(page);
    expect(await currentTime(page)).toBeLessThan(0.05);

    // c-warn: ts=T0+200 → 0.2초.
    await page.locator('[data-entry-id="c-warn"]').click();
    await expect.poll(() => currentTime(page)).toBeGreaterThan(0.1);
    expect(Math.abs((await currentTime(page)) - 0.2)).toBeLessThan(0.12);
  });

  test("mm:ss 칩 클릭 → 시크만, 행 펼치기 미발동(stopPropagation)", async ({ page }) => {
    await openWithVideo(page);
    const row = page.locator('[data-entry-id="c-err"]'); // ts=T0+100 → 0.1초

    await row.getByTestId("log-rel-time").click();

    await expect.poll(() => currentTime(page)).toBeGreaterThan(0.02);
    expect(Math.abs((await currentTime(page)) - 0.1)).toBeLessThan(0.12);
    // 칩이 stopPropagation → 행 onClick(펼치기) 미발동: 펼침 상세(.pt-1) 없음.
    await expect(row.locator(".pt-1")).toHaveCount(0);
  });
});
