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

  // 도형 시각 정합 일반(모양·색·두께)은 여전히 수동이지만, **어느 쪽에 그려졌나**는 훨씬 거친
  // 판정이라 자동화된다. Konva는 레이어당 canvas를 만들고 배경 이미지가 별 레이어라
  // (`<Layer listening={false}>` + KonvaImage), 도형 레이어만 스캔하면 alpha가 곧 "획이 있나"다.
  //
  // 이 그물이 필요한 이유: ellipseRenderGeometry의 유닛은 함수가 옳은 값을 내는지만 본다.
  // ShapeNode가 그 값을 실제로 <Ellipse> props로 넘기는지, Konva가 우리 해석대로 렌더하는지는
  // 캔버스 실동작이라 배선을 옛 식으로 되돌려도 유닛은 전부 green이다.
  test("ellipse 좌상단 드래그 — 원이 앵커 반대편에 그려지지 않는다", async () => {
    await panel.getByTestId("annotation-edit").click();
    const overlay = panel.getByTestId("annotation-overlay");
    await expect(overlay).toBeVisible();
    await expect(panel.getByTestId("annotation-tool-ellipse")).toBeVisible();

    await panel.getByTestId("annotation-tool-ellipse").click();
    await expect(panel.getByTestId("annotation-tool-ellipse")).toHaveAttribute(
      "data-active",
      "true",
    );

    const shapeLayer = overlay.locator("canvas").last();
    const box = await overlay.locator("canvas").first().boundingBox();
    if (!box) throw new Error("annotation canvas boundingBox 없음");

    // 캔버스 중앙을 앵커로 두고 좌상단으로 끈다 — width·height가 음수가 되는 경로다.
    const ax = box.x + box.width / 2;
    const ay = box.y + box.height / 2;
    await panel.mouse.move(ax, ay);
    await panel.mouse.down();
    await panel.mouse.move(ax - box.width * 0.25, ay - box.height * 0.25, { steps: 10 });
    await panel.mouse.up();
    await expect(panel.getByTestId("annotation-done")).toBeEnabled();

    // 앵커(캔버스 중앙)를 기준으로 네 사분면의 불투명 픽셀을 센다. 좌상단으로 끌었으니
    // 획은 좌상단에만 있어야 하고, 거울 반사되면 우하단에 나타난다.
    const counts = await shapeLayer.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("2d context 없음");
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      const cx = Math.round(c.width / 2);
      const cy = Math.round(c.height / 2);
      let upLeft = 0;
      let downRight = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] === 0) continue;
          if (x < cx && y < cy) upLeft++;
          else if (x > cx && y > cy) downRight++;
        }
      }
      return { upLeft, downRight };
    });

    expect(counts.upLeft).toBeGreaterThan(0);
    expect(counts.downRight).toBe(0);

    await panel.getByTestId("annotation-cancel").click();
    await expect(overlay).toBeHidden();
  });
});
