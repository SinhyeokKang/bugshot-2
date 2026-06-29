import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// konva 주석 오버레이 — Konva Stage는 단일 <canvas>라 도형 자체는 DOM 노드가 아니다.
// 캔버스 외부 신호만 판정한다: 오버레이 visible/hidden, 도구 active(data-active),
// 미디어 미리보기 img src 전이(raw → annotated webp → raw 복귀). 도형 시각 정합은 수동.
// captureVisibleTab rate-limit 때문에 캡처는 beforeAll 1회만 하고 serial로 이어 검증한다.

test.describe.serial("annotation overlay", () => {
  let fixture: Page;
  let panel: Page;
  let rawSrc: string;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);

    const drafting = panel.getByTestId("drafting-panel");
    await expect(async () => {
      if (!(await drafting.isVisible())) {
        await panel.getByTestId("mode-screenshot").click();
        await fixture.bringToFront();
        await fixture.mouse.move(60, 60);
        await fixture.mouse.down();
        await fixture.mouse.move(300, 240, { steps: 10 });
        await fixture.mouse.up();
        await panel.bringToFront();
      }
      await expect(drafting).toBeVisible({ timeout: 2500 });
    }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 25_000 });

    rawSrc = (await panel.getByTestId("media-preview-img").getAttribute("src")) ?? "";
    expect(rawSrc.length).toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("연필 → 오버레이 열림, 도구 active, 빈 상태 done 비활성, 취소 → img 불변", async () => {
    await panel.getByTestId("annotation-edit").click();

    const overlay = panel.getByTestId("annotation-overlay");
    await expect(overlay).toBeVisible();
    // lazy 청크 로드 후 툴바 렌더 대기.
    await expect(panel.getByTestId("annotation-tool-rect")).toBeVisible();

    await panel.getByTestId("annotation-tool-rect").click();
    await expect(panel.getByTestId("annotation-tool-rect")).toHaveAttribute(
      "data-active",
      "true",
    );

    // 도형이 없으면 done은 disabled.
    await expect(panel.getByTestId("annotation-done")).toBeDisabled();

    await panel.getByTestId("annotation-cancel").click();
    await expect(overlay).toBeHidden();
    await expect(panel.getByTestId("media-preview-img")).toHaveAttribute("src", rawSrc);
  });

  test("도형 그린 뒤 done → annotated webp 전이, 제거 → raw 복귀", async () => {
    await panel.getByTestId("annotation-edit").click();
    const overlay = panel.getByTestId("annotation-overlay");
    await expect(overlay).toBeVisible();
    await expect(panel.getByTestId("annotation-tool-rect")).toBeVisible();

    await panel.getByTestId("annotation-tool-rect").click();

    // Konva Stage 캔버스 위에서 드래그 → rect 도형 커밋(width·height>0). Stage는 CSS scale돼
    // 있지만 getPointerPosition이 transform을 보정하므로 화면 좌표 드래그로 충분하다.
    const canvas = overlay.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("annotation canvas boundingBox 없음");
    await panel.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await panel.mouse.down();
    await panel.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, {
      steps: 10,
    });
    await panel.mouse.up();

    // 도형이 들어가면 done 활성.
    const done = panel.getByTestId("annotation-done");
    await expect(done).toBeEnabled();
    await done.click();

    await expect(overlay).toBeHidden();
    const annotatedSrc = await panel
      .getByTestId("media-preview-img")
      .getAttribute("src");
    expect(annotatedSrc).not.toBe(rawSrc);
    expect(annotatedSrc?.startsWith("data:image/webp")).toBe(true);

    // 주석 제거(RotateCcw) → screenshotAnnotated 클리어 → raw 복귀.
    await panel.getByTestId("annotation-remove").click();
    await expect(panel.getByTestId("media-preview-img")).toHaveAttribute("src", rawSrc);
    await expect(panel.getByTestId("annotation-remove")).toHaveCount(0);
  });
});
