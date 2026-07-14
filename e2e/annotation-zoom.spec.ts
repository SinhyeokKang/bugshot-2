import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 어노테이션 캔버스 줌·팬. 기존 annotation-overlay.spec은 영역 캡처(240×180)라 fit=1·팬 불가라서
// 줌 시나리오를 하나도 태울 수 없다 → 스크롤(페이지 전체) 캡처로 진입하는 별도 spec.
// 판정은 캔버스 밖 신호만: 줌 라벨 텍스트, aria-disabled, 맞춤 버튼 유무, 뷰포트 scrollTop,
// 삭제 버튼 enabled(=선택 여부), 결과 img naturalWidth. 도형 시각 정합은 수동.
//
// 주의: e2e 뷰포트(480×720)에선 fit-width가 문서 예시(36%)가 아니라 90%대로 나온다 →
// 절대 배율로 단언하지 말고 상대 비교·버튼 상태로 판정한다.
test.describe.serial("annotation zoom", () => {
  let fixture: Page;
  let panel: Page;
  let rawWidth: number;
  let entryLabel: string;

  const zoomLabel = () => panel.getByTestId("annotation-zoom-level");
  const zoomIn = () => panel.getByTestId("annotation-zoom-in");
  const zoomOut = () => panel.getByTestId("annotation-zoom-out");
  const fitBtn = () => panel.getByTestId("annotation-zoom-fit");
  const viewport = () => panel.getByTestId("annotation-canvas-viewport");
  const percent = async () => Number((await zoomLabel().innerText()).replace("%", ""));
  const scrollTop = () => viewport().evaluate((el) => el.scrollTop);

  // 뷰포트 안(=실제 보이는 영역) 좌표. 캔버스는 뷰포트보다 세로로 길어 canvas bbox 기준으로
  // 잡으면 화면 밖 좌표가 나온다.
  const at = async (fx: number, fy: number): Promise<[number, number]> => {
    const box = await viewport().boundingBox();
    if (!box) throw new Error("viewport boundingBox 없음");
    return [box.x + box.width * fx, box.y + box.height * fy];
  };
  const drag = async (from: [number, number], to: [number, number]) => {
    await panel.mouse.move(...from);
    await panel.mouse.down();
    await panel.mouse.move(...to, { steps: 8 });
    await panel.mouse.up();
  };

  const openOverlay = async () => {
    await panel.getByTestId("annotation-edit").click();
    await expect(panel.getByTestId("annotation-overlay")).toBeVisible();
  };
  const closeOverlay = async () => {
    await panel.getByTestId("annotation-cancel").click();
    await expect(panel.getByTestId("annotation-overlay")).toBeHidden();
  };

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("scroll-capture.html"));
    const tabId = await ext.fixtureTabId("http://127.0.0.1/scroll-capture.html");
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);

    // 스크롤 캡처는 타일마다 tab.active를 확인한다 → fixture를 앞에 두고 패널 버튼은 DOM 클릭.
    // captureVisibleTab quota 회복을 위해 1초+ 간격 재시도(GOTCHAS).
    const drafting = panel.getByTestId("drafting-panel");
    await expect(async () => {
      if (!(await drafting.isVisible())) {
        await panel.bringToFront();
        await panel.getByTestId("mode-screenshot").click();
        const fullPage = panel.getByTestId("capture-method-fullpage");
        await expect(fullPage).toBeVisible();
        await fixture.bringToFront();
        await fullPage.evaluate((el) => (el as HTMLElement).click());
      }
      await expect(drafting).toBeVisible({ timeout: 4000 });
    }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 40_000 });
    await panel.bringToFront();

    rawWidth = await panel
      .getByTestId("media-preview-img")
      .evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(rawWidth).toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("진입 → fit-width(맞춤) 상태: 맞춤 버튼 숨김, 세로가 넘쳐 [-]는 활성(전체 스톱 존재)", async () => {
    await openOverlay();

    entryLabel = await zoomLabel().innerText();
    expect(entryLabel).toMatch(/^\d+%$/);
    await expect(fitBtn()).toHaveCount(0);
    // 페이지 전체 캡처는 세로가 넘치므로 fitAll < fit → 전체 스톱이 있어 축소 가능.
    await expect(zoomOut()).not.toHaveAttribute("aria-disabled", "true");
    await expect(zoomIn()).not.toHaveAttribute("aria-disabled", "true");
  });

  test("[+] → 배율 증가 + 맞춤 버튼 등장 / 맞춤 → 진입 배율 복귀 + 버튼 소실", async () => {
    const before = await percent();
    await zoomIn().click();

    await expect(async () => expect(await percent()).toBeGreaterThan(before)).toPass();
    await expect(fitBtn()).toBeVisible();

    await fitBtn().click();
    await expect(zoomLabel()).toHaveText(entryLabel);
    await expect(fitBtn()).toHaveCount(0);
  });

  test("콤보박스 100% 선택 → 라벨 100% / [+] 상한에서 400% + aria-disabled", async () => {
    await zoomLabel().click();
    await panel.getByRole("option", { name: "100%", exact: true }).click();
    await expect(zoomLabel()).toHaveText("100%");

    for (let i = 0; i < 5; i++) {
      if ((await zoomIn().getAttribute("aria-disabled")) === "true") break;
      await zoomIn().click();
    }
    await expect(zoomLabel()).toHaveText("400%");
    await expect(zoomIn()).toHaveAttribute("aria-disabled", "true");

    await fitBtn().click();
    await expect(zoomLabel()).toHaveText(entryLabel);
  });

  test("선택 도구로 빈 곳 드래그 → 뷰포트가 스크롤된다 (맞춤 상태에서도 세로가 넘침)", async () => {
    // 앞 테스트의 줌 조작으로 중앙 앵커 스크롤이 남아 있을 수 있다 → 기준을 0으로 맞춘다.
    await viewport().evaluate((el) => (el.scrollTop = 0));
    await drag(await at(0.5, 0.75), await at(0.5, 0.25));
    expect(await scrollTop()).toBeGreaterThan(0);

    await viewport().evaluate((el) => (el.scrollTop = 0));
  });

  test("도형 클릭 → 선택(삭제 활성), 빈 곳 클릭 → 해제 (팬 도입 회귀 가드)", async () => {
    const del = panel.getByTestId("annotation-delete");
    await expect(del).toBeDisabled();

    // rect 도구로 그린다. 그리기 직후엔 자동 선택되지 않는다.
    await panel.getByTestId("annotation-tool-rect").click();
    await drag(await at(0.3, 0.3), await at(0.7, 0.6));
    await expect(del).toBeDisabled();

    // 선택 도구로 전환 → rect 상단 변(hit 영역 안)을 클릭 → 선택.
    await panel.getByTestId("annotation-tool-select").click();
    const [tx, ty] = await at(0.5, 0.3);
    await panel.mouse.click(tx, ty);
    await expect(del).toBeEnabled();

    // 빈 곳 클릭(드래그 아님) → 선택 해제. 팬은 3px 임계값을 넘어야 한다.
    const [ex, ey] = await at(0.12, 0.85);
    await panel.mouse.click(ex, ey);
    await expect(del).toBeDisabled();
  });

  test("도형 드래그 → 도형이 이동하고 뷰포트는 스크롤되지 않는다", async () => {
    await viewport().evaluate((el) => (el.scrollTop = 0));
    const [tx, ty] = await at(0.5, 0.3);
    await panel.mouse.click(tx, ty);
    await expect(panel.getByTestId("annotation-delete")).toBeEnabled();

    await drag([tx, ty], await at(0.5, 0.45));
    expect(await scrollTop()).toBe(0); // 도형 이동이지 팬이 아니다
    await expect(panel.getByTestId("annotation-delete")).toBeEnabled();
  });

  test("확대 상태로 그려도 완료 결과는 원본 해상도다 (export가 배율에 안 묶임)", async () => {
    await zoomLabel().click();
    await panel.getByRole("option", { name: "100%", exact: true }).click();
    await expect(zoomLabel()).toHaveText("100%");

    await panel.getByTestId("annotation-tool-rect").click();
    await drag(await at(0.3, 0.3), await at(0.6, 0.5));

    const done = panel.getByTestId("annotation-done");
    await expect(done).toBeEnabled();
    await done.click();
    await expect(panel.getByTestId("annotation-overlay")).toBeHidden();

    const img = panel.getByTestId("media-preview-img");
    await expect(img).toHaveAttribute("src", /^data:image\/webp/);
    const annotatedWidth = await img.evaluate(
      (el) => (el as HTMLImageElement).naturalWidth,
    );
    expect(annotatedWidth).toBe(rawWidth);
  });

  test("작은 이미지(팬 불가)로 다시 열면 맞춤 상태에서 [-]가 aria-disabled", async () => {
    // 주석 제거 → raw 복귀 후, 확대 없이 열린 상태에서 축소 스톱이 없는지 확인.
    await panel.getByTestId("annotation-remove").click();
    await openOverlay();
    // 페이지 전체 캡처라 여전히 세로가 넘친다 → 전체 스톱이 있어 [-]는 활성.
    await expect(zoomOut()).not.toHaveAttribute("aria-disabled", "true");
    // 전체(fitAll)까지 내리면 더는 축소할 수 없다.
    await zoomOut().click();
    await expect(zoomOut()).toHaveAttribute("aria-disabled", "true");
    await expect(fitBtn()).toBeVisible();
    await closeOverlay();
  });
});
