import type { Page } from "@playwright/test";

import { test, expect, enterDebug } from "./fixtures/extension";

// capture.spec.ts의 captureUntilDrafting과 같은 이유(captureVisibleTab quota 회복 대기)로
// 트리거를 1초+ 간격으로 재시도한다. timeout 증액이 아니라 간격을 quota 주기에 맞추는 것.
async function captureUntilDrafting(panel: Page, trigger: () => Promise<void>): Promise<void> {
  const drafting = panel.getByTestId("drafting-panel");
  await expect(async () => {
    if (!(await drafting.isVisible())) await trigger();
    await expect(drafting).toBeVisible({ timeout: 4000 });
  }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 40_000 });
}

test("screenshot 뷰포트 캡처 → drafting 진입", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);

  // capturing 단계 하단 툴바에서 [뷰포트 캡처] — 드래그 없이 areaSelected가 발화한다.
  await captureUntilDrafting(panel, async () => {
    await panel.getByTestId("mode-screenshot").click();
    const viewportBtn = panel.getByTestId("capture-method-viewport");
    await expect(viewportBtn).toBeVisible();
    await expect(viewportBtn).not.toHaveAttribute("aria-disabled", "true");
    await viewportBtn.click();
  });

  const img = panel.getByTestId("media-preview-img");
  await expect(img).toBeVisible();

  await panel.close();
  await fixture.close();
});

test("screenshot 스크롤 캡처 → 뷰포트보다 세로로 긴 이미지로 drafting 진입", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("scroll-capture.html"));
  const tabId = await ext.fixtureTabId("http://127.0.0.1/scroll-capture.html");
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);

  // 타일 2장짜리 fixture(뷰포트 1.5배 높이) — 캡처 큐(타일당 ≥500ms)를 최소로 태운다.
  // 스크롤 캡처는 타일마다 tab.active를 확인한다(다른 탭 화면이 섞이는 것 방지). e2e에선
  // 사이드패널이 탭이라 패널을 앞에 두면 fixture가 비활성이 되므로, fixture를 앞으로 보낸 뒤
  // 백그라운드 패널의 버튼을 DOM 클릭으로 누른다(실제 제품에선 패널이 탭이 아니라 무관).
  await captureUntilDrafting(panel, async () => {
    await panel.bringToFront();
    await panel.getByTestId("mode-screenshot").click();
    const fullPageBtn = panel.getByTestId("capture-method-fullpage");
    await expect(fullPageBtn).toBeVisible();
    await expect(fullPageBtn).not.toHaveAttribute("aria-disabled", "true");
    await fixture.bringToFront();
    await fullPageBtn.evaluate((el) => (el as HTMLElement).click());
  });
  await panel.bringToFront();

  const img = panel.getByTestId("media-preview-img");
  await expect(img).toBeVisible();

  const pageMetrics = await fixture.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
  }));

  // 스티치 결과는 보이는 화면보다 세로로 길어야 한다(뷰포트 캡처와 구분되는 유일한 판정).
  const ratio = await img.evaluate((el) => {
    const image = el as HTMLImageElement;
    return image.naturalHeight / image.naturalWidth;
  });
  const pageRatio = await fixture.evaluate(() => window.innerHeight / window.innerWidth);
  expect(ratio).toBeGreaterThan(pageRatio * 1.2);

  // 자홍 sticky bar는 첫 타일에는 존재하되 두 번째 타일 경계에는 반복되면 안 된다.
  const stickySamples = await img.evaluate(async (el, metrics) => {
    const image = el as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(image, 0, 0);
    const scale = image.naturalWidth / metrics.width;
    const sample = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    return {
      first: sample(Math.floor(100 * scale), Math.floor(60 * scale)),
      repeated: sample(
        Math.floor(100 * scale),
        Math.floor((metrics.height + 60) * scale),
      ),
    };
  }, pageMetrics);
  const isMagenta = ([r, g, b]: number[]) => r > 170 && g < 130 && b > 170;
  expect(isMagenta(stickySamples.first)).toBe(true);
  expect(isMagenta(stickySamples.repeated)).toBe(false);

  // 캡처가 끝나면 페이지 스크롤이 원위치로 복원된다.
  await expect
    .poll(async () => fixture.evaluate(() => window.scrollY), { timeout: 5000 })
    .toBe(0);

  await panel.close();
  await fixture.close();
});
