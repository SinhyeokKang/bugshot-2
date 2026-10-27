import { test, expect, openViewer, generateTinyVideoDataUrl, makeActionLog, T0 } from "./fixtures";
import type { Page } from "@playwright/test";

const meta = { version: "1", createdAt: "2026-01-01", pageUrl: "https://example.com", issueTitle: "Short capture regression", issueKey: "BUG-12", issueUrl: "https://example.com/BUG-12" };

async function images(page: Page) {
  return page.evaluate(() => [
    [1000, 20], [300, 1800], [1200, 300], [1000, 20],
  ].map(([width, height], index) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = ["red", "green", "blue", "orange"][index];
    ctx.fillRect(0, 0, width, height);
    return { dataUrl: canvas.toDataURL("image/png") };
  }));
}

async function decode(page: Page) {
  await page.locator("img").evaluateAll(async (nodes) => {
    await Promise.all(nodes.map((node) => (node as HTMLImageElement).decode()));
  });
}

test.describe("static capture geometry", () => {
  test.use({ locale: "en-US" });

  test("short, tall and wide images fit the panel, share a bounded header and scroll to the last image after resize", async ({ page }) => {
    const screenshots = await images(page);
    await openViewer(page, { screenshots, meta });
    await expect(page.locator("img")).toHaveCount(4);
    await decode(page);
    expect(await page.locator("img").evaluateAll((nodes) => nodes.map((node) => (node as HTMLImageElement).src))).toEqual(screenshots.map((s) => s.dataUrl));
    // A short image must not host an absolute title/link that crosses into its neighbor.
    await expect(page.getByRole("heading", { name: meta.issueTitle })).toHaveCount(1);
    const header = page.getByTestId("static-issue-header");
    await expect(header).toBeVisible();
    await expect(header.getByRole("link")).toHaveAttribute("href", meta.issueUrl);
    for (const width of [1280, 900]) {
      await page.setViewportSize({ width, height: 800 });
      const list = page.getByTestId("screenshot-list");
      await list.evaluate((el) => { el.scrollTop = 0; });
      await expect.poll(async () => {
        const h = await header.boundingBox();
        const first = await page.locator("img").first().boundingBox();
        return h!.y + h!.height <= first!.y;
      }).toBe(true);
      const headerBox = await header.boundingBox();
      const linkBox = await header.getByRole("link").boundingBox();
      expect(linkBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
      expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height);
      const metrics = await list.evaluate((el) => ({
        width: el.clientWidth, height: el.clientHeight, scrollHeight: el.scrollHeight,
        rows: [...el.querySelectorAll("img")].map((img) => ({ width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height, ratio: img.naturalHeight / img.naturalWidth })),
      }));
      expect(metrics.height).toBeGreaterThan(100);
      expect(metrics.height).toBeLessThan(800);
      expect(metrics.scrollHeight).toBeGreaterThan(metrics.height);
      for (const row of metrics.rows) {
        expect(Math.abs(row.width - metrics.width)).toBeLessThan(1);
        expect(Math.abs(row.height - row.width * row.ratio)).toBeLessThan(1);
      }
      await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const last = await page.locator("img").last().boundingBox();
      const viewport = await list.boundingBox();
      expect(last!.y).toBeGreaterThanOrEqual(viewport!.y - 1);
      expect(last!.y + last!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height + 1);
      expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    }
    // Resize the actual split panel as well as the browser viewport.
    const handle = page.locator('[data-panel-resize-handle-id]').first();
    const before = await page.locator("img").first().boundingBox();
    const grip = await handle.boundingBox();
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip!.x - 100, grip!.y + grip!.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await page.locator("img").first().boundingBox())!.width).toBeLessThan(before!.width - 50);
  });

  for (const source of ["legacy", "array"] as const) {
    test(`${source} singleton retains contained image geometry`, async ({ page }) => {
      const screenshots = await images(page);
      await openViewer(page, { meta, ...(source === "legacy" ? { screenshot: screenshots[1] } : { screenshots: [screenshots[1]] }) });
      await expect(page.locator("img")).toHaveCount(1);
      await decode(page);
      const image = page.locator("img");
      await expect(image).toHaveCSS("object-fit", "contain");
      const bounds = await image.boundingBox();
      expect(bounds!.height).toBeGreaterThan(500);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800);
      expect(bounds!.width).toBeLessThan(1280);
      await expect(page.getByTestId("screenshot-list")).toHaveCount(0);
      await image.hover();
      await expect(page.getByRole("heading", { name: meta.issueTitle })).toHaveCSS("opacity", "1");
    });
  }

  test("decoded video takes precedence and renders actionable timeline content", async ({ page }) => {
    const screenshots = await images(page);
    const dataUrl = await generateTinyVideoDataUrl(page);
    await openViewer(page, { screenshots, video: { dataUrl, startedAt: T0 }, actionLog: makeActionLog(), meta });
    await expect(page.locator("img")).toHaveCount(0);
    await expect.poll(() => page.locator("video").evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("timeline-row")).toHaveCount(6);
    await expect(page.getByTestId("timeline-row").first()).toContainText("Save button");
    await page.getByTestId("timeline-row").first().click();
    await expect.poll(() => page.locator("video").evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(0.1, 1);
  });
});
