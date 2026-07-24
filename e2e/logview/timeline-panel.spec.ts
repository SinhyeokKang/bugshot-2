import { test, expect, type Page } from "@playwright/test";
import {
  openViewer,
  makeConsoleLog,
  makeNetworkLog,
  makeActionLog,
  generateTinyVideoDataUrl,
  T0,
} from "./fixtures";

// video + 3종 로그를 주입하면 영상 아래 통합 타임라인 패널이 뜬다(App의 video && !videoError 게이트).
// console 5 + network 7 + action 6 = 18행. 영상 startedAt=T0라 T0+ms 로그가 (ms/1000)초로 매핑된다.
async function openWithTimeline(page: Page): Promise<void> {
  const dataUrl = await generateTinyVideoDataUrl(page);
  await openViewer(page, {
    video: { dataUrl, startedAt: T0 },
    consoleLog: makeConsoleLog(),
    networkLog: makeNetworkLog(),
    actionLog: makeActionLog(),
  });
  await page.locator("video").waitFor();
  await page.getByTestId("timeline-scroll").waitFor();
  // seek 검증이 재생 진행에 흔들리지 않게 정지 상태로 고정.
  await page.$eval("video", (v: HTMLVideoElement) => v.pause());
}

function currentTime(page: Page): Promise<number> {
  return page.$eval("video", (v: HTMLVideoElement) => v.currentTime);
}

const rows = (page: Page) => page.getByTestId("timeline-row");

test.describe("log-viewer 통합 타임라인 패널", () => {
  test("3종 로그가 시간순 병합 + 필터 카운트 뱃지", async ({ page }) => {
    await openWithTimeline(page);

    await expect(rows(page)).toHaveCount(18);
    await expect(page.locator('[data-testid="timeline-row"][data-kind="console"]')).toHaveCount(5);
    await expect(page.locator('[data-testid="timeline-row"][data-kind="network"]')).toHaveCount(7);
    await expect(page.locator('[data-testid="timeline-row"][data-kind="action"]')).toHaveCount(6);

    // 필터 탭 count 뱃지(로그 탭 뱃지 패턴) — 라벨 i18n 무관, 숫자만 판정.
    await expect(page.getByTestId("timeline-filter-all")).toContainText("18");
    await expect(page.getByTestId("timeline-filter-console")).toContainText("5");
    await expect(page.getByTestId("timeline-filter-network")).toContainText("7");
    await expect(page.getByTestId("timeline-filter-action")).toContainText("6");

    // 기본 필터는 All 활성.
    await expect(page.getByTestId("timeline-filter-all")).toHaveAttribute("data-state", "active");
  });

  test("타입 필터 단일선택으로 해당 종류만 노출", async ({ page }) => {
    await openWithTimeline(page);

    await page.getByTestId("timeline-filter-network").click();
    await expect(page.getByTestId("timeline-filter-network")).toHaveAttribute("data-state", "active");
    await expect(rows(page)).toHaveCount(7);
    await expect(page.locator('[data-testid="timeline-row"]:not([data-kind="network"])')).toHaveCount(0);

    await page.getByTestId("timeline-filter-action").click();
    await expect(rows(page)).toHaveCount(6);
    await expect(page.locator('[data-testid="timeline-row"][data-kind="action"]')).toHaveCount(6);

    await page.getByTestId("timeline-filter-all").click();
    await expect(rows(page)).toHaveCount(18);
  });

  test("검색이 console args·network 응답 본문까지 매칭(필터=all)", async ({ page }) => {
    await openWithTimeline(page);
    const search = page.getByTestId("timeline-search");

    // 콘솔 args에만 있는 마커 → c-err 콘솔 행 1개.
    await search.fill("zqxconsoleneedle");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute("data-kind", "console");

    // 네트워크 응답 본문에만 있는(URL엔 없는) 마커 → n-json 네트워크 행 1개.
    await search.fill("zqxbodyneedle");
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute("data-kind", "network");

    await search.fill("");
    await expect(rows(page)).toHaveCount(18);
  });

  test("행 클릭 → 영상 seek + 해당 로그 탭으로 전환", async ({ page }) => {
    await openWithTimeline(page);

    // 우측 기본 탭은 console(리포트 없음).
    await expect(page.getByTestId("logview-tab-console")).toHaveAttribute("data-state", "active");
    expect(await currentTime(page)).toBeLessThan(0.05);

    // 네트워크 행 클릭 → network 탭 활성 + 영상이 요청 시각(T0+100=0.1초)으로 이동.
    await page.getByTestId("timeline-filter-network").click();
    await rows(page).first().click();
    await expect(page.getByTestId("logview-tab-network")).toHaveAttribute("data-state", "active");
    await expect.poll(() => currentTime(page)).toBeGreaterThan(0.05);
    expect(Math.abs((await currentTime(page)) - 0.1)).toBeLessThan(0.12);

    // 액션 마지막 행(a-select @T0+600) 클릭 → action 탭 활성 + 0.6초 이동.
    await page.getByTestId("timeline-filter-action").click();
    await rows(page).nth(5).click();
    await expect(page.getByTestId("logview-tab-action")).toHaveAttribute("data-state", "active");
    await expect.poll(() => currentTime(page)).toBeGreaterThan(0.5);
    expect(Math.abs((await currentTime(page)) - 0.6)).toBeLessThan(0.12);
  });

  test("playhead 진행 → 해당 시각 이하 마지막 행이 active 하이라이트", async ({ page }) => {
    await openWithTimeline(page);
    await page.getByTestId("timeline-filter-action").click();

    // 시작(currentAbsMs=startedAt)엔 모든 항목이 미래라 active 없음.
    await expect(page.locator('[data-testid="timeline-row"][data-active="true"]')).toHaveCount(0);

    // 0.65초로 이동 → 마지막 action(a-select @0.6)만 active.
    await page.$eval("video", (v: HTMLVideoElement) => { v.currentTime = 0.65; });
    await expect(page.locator('[data-testid="timeline-row"][data-active="true"]')).toHaveCount(1);
    await expect(rows(page).nth(5)).toHaveAttribute("data-active", "true");
  });
});
