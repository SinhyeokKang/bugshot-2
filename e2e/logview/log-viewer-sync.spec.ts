import { test, expect, type Page } from "@playwright/test";
import {
  openViewer,
  makeConsoleLog,
  makeNetworkLog,
  makeActionLog,
  makeReport,
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

  test("Report 탭을 열어도 타임라인 마커가 유지된다", async ({ page }) => {
    const dataUrl = await generateTinyVideoDataUrl(page);
    await openViewer(page, {
      video: { dataUrl, startedAt: T0 },
      consoleLog: makeConsoleLog(),
      networkLog: makeNetworkLog(),
      actionLog: makeActionLog(),
      report: makeReport(),
    });
    await page.locator("video").waitFor();
    await expect(page.getByTestId("timeline-marker").first()).toBeVisible();

    // Report 탭으로 전환해도 좌측 영상 타임라인 마커는 그대로여야 한다.
    await page.getByTestId("logview-tab-report").click();
    await expect(page.getByTestId("logview-tab-report")).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("timeline-marker").first()).toBeVisible();
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

test("keyboard seeking exposes playback time and a visible focus ring", async ({ page }) => {
  const dataUrl = await generateTinyVideoDataUrl(page);
  await openViewer(page, { video: { dataUrl, startedAt: T0 } });
  const video = page.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(0);
  const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
  const slider = page.getByRole("slider");
  const unfocusedShadow = await slider.evaluate((el) => getComputedStyle(el).boxShadow);
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await slider.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(slider).toBeFocused();
  expect(await slider.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  const focusedShadow = await slider.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(focusedShadow).not.toBe("none");
  expect(focusedShadow).not.toBe(unfocusedShadow);
  for (const dark of [false, true]) {
    await page.evaluate((value) => document.documentElement.classList.toggle("dark", value), dark);
    const contrast = await slider.evaluate((el) => {
      const colors = getComputedStyle(el).boxShadow.match(/rgba?\([^)]+\)/g)!;
      const luminance = (color: string) => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map((channel) => {
          const value = Number(channel) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const offset = luminance(colors[0]);
      const ring = luminance(colors[1]);
      return (Math.max(offset, ring) + 0.05) / (Math.min(offset, ring) + 0.05);
    });
    expect(contrast, `focus contrast in ${dark ? "dark" : "light"} theme`).toBeGreaterThanOrEqual(3);
  }
  await expect(slider).toHaveAttribute("aria-valuemax", String(duration));
  for (const [key, seconds] of [["End", duration], ["ArrowRight", duration], ["Home", 0], ["ArrowLeft", 0], ["ArrowUp", Math.min(5, duration)], ["ArrowDown", 0]] as const) {
    await page.keyboard.press(key);
    await expect.poll(() => currentTime(page)).toBeCloseTo(seconds, 1);
    await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeCloseTo(seconds, 1);
  }
  await expect(slider).toHaveAttribute("aria-valuetext", /^0:00 \/ \d+:\d{2}$/);
});
