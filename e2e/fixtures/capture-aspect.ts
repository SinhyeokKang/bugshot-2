import type { Frame, Page } from "@playwright/test";

import { expect } from "./extension";

// cropImage가 rect 사방에 붙이는 기본 마진(capture.ts DEFAULT_MARGIN).
export const MARGIN = 24;

// 측정 문맥. 디바이스 뷰포트 모드에서는 요소가 래퍼 iframe 안에 있어 Page가 아니라 Frame이
// 들어온다 — window.innerWidth·getBoundingClientRect가 **그 프레임 기준**이어야 게이트 판정과
// 종횡비가 실제 크롭 기준과 같은 좌표계에서 나온다.
type Measurable = Page | Frame;

/**
 * 스냅샷 이미지의 종횡비. 픽셀 폭을 CSS px로 환산하지 않는 이유: naturalWidth는
 * captureVisibleTab이 실제 backing store 해상도로 찍은 값인데, Playwright는 페이지의
 * devicePixelRatio를 1로 고정하므로 페이지에서 읽은 DPR로는 배율을 복원할 수 없다.
 * 종횡비는 배율이 약분돼 사라지므로 "어느 rect로 잘랐나"를 배율 없이 판정한다.
 * (iframe 응답은 top 좌표로 **평행이동**만 되므로 종횡비가 보존된다 — 래퍼에도 그대로 쓴다.)
 */
export async function snapshotAspect(
  panel: Page,
  which: "before" | "after",
): Promise<number> {
  const img = panel.getByTestId(`snapshot-${which}`);
  await expect(img).toBeVisible();
  return img.evaluate(async (el) => {
    const image = el as HTMLImageElement;
    await image.decode();
    return image.naturalWidth / image.naturalHeight;
  });
}

// 그 rect로 잘랐다면 나왔을 종횡비(사방 마진 포함).
export async function expectedAspect(
  ctx: Measurable,
  selector: string,
): Promise<number> {
  return ctx.locator(selector).evaluate((el, margin) => {
    const r = el.getBoundingClientRect();
    return (r.width + margin * 2) / (r.height + margin * 2);
  }, MARGIN);
}

// 확장 가설과 폴백 가설이 실제로 구분되는지 먼저 확인한다. 픽스처 크기가 창 비율에
// 따라 두 종횡비를 가깝게 만들면 아래 단언이 통과해도 아무것도 증명하지 못한다.
export async function assertHypothesesSeparable(
  ctx: Measurable,
  containerSelector: string,
  elementSelector: string,
): Promise<{ container: number; element: number }> {
  const container = await expectedAspect(ctx, containerSelector);
  const element = await expectedAspect(ctx, elementSelector);
  expect(Math.abs(container - element)).toBeGreaterThan(0.5);
  return { container, element };
}

// 픽스처가 확장 게이트 셋(G1 뷰포트 완전 포함 / G2 요소 완전 포함 / G3 면적 40% 이하)을
// 실제로 만족하는지 확인한다. 하나라도 깨지면 제품은 정상적으로 폴백하므로, 이 단언이
// 없으면 "확장이 안 걸렸다"가 구현 회귀인지 픽스처 붕괴인지 구별되지 않는다.
// (모달 높이가 내용보다 작아 버튼이 박스 밖으로 나가 G2가 깨진 전례가 있다.)
export async function assertGatesSatisfied(
  ctx: Measurable,
  containerSelector: string,
  elementSelector: string,
): Promise<void> {
  const gates = await ctx.evaluate(
    ([containerSel, elementSel]) => {
      const c = document.querySelector(containerSel)!.getBoundingClientRect();
      const e = document.querySelector(elementSel)!.getBoundingClientRect();
      return {
        withinViewport:
          c.x >= 0 &&
          c.y >= 0 &&
          c.x + c.width <= window.innerWidth &&
          c.y + c.height <= window.innerHeight,
        containsElement:
          e.x >= c.x &&
          e.y >= c.y &&
          e.x + e.width <= c.x + c.width &&
          e.y + e.height <= c.y + c.height,
        areaRatio: (c.width * c.height) / (window.innerWidth * window.innerHeight),
      };
    },
    [containerSelector, elementSelector],
  );
  expect(gates.withinViewport).toBe(true);
  expect(gates.containsElement).toBe(true);
  expect(gates.areaRatio).toBeLessThanOrEqual(0.4);
}

// pick 직후 발행되는 **before 캡처**가 background 직렬 큐에서 빠져나올 때까지 fixture를 앞에 둔다.
// 이걸 안 하면 typeStyleValue가 패널을 앞으로 가져오고, 큐가 그 캡처에 도달했을 때
// captureOwnedTab의 tab.active 재확인에서 거부된다 — before 기준이 저장되지 않아 after만
// 요소 bbox로 폴백하고, 증상은 "확장이 안 걸림"으로만 보인다. after 캡처와 달리 before는
// 재시도 지점이 없어서 여기서 한 번 놓치면 그대로 끝난다.
// 대기는 timeout 늘리기가 아니라 캡처 큐·quota 주기(~500ms 간격 + 백오프)에 맞춘 간격이다.
export async function settleBeforeCapture(fixture: Page): Promise<void> {
  await fixture.bringToFront();
  await fixture.waitForTimeout(1500);
}

// [다음]은 aria-disabled+클릭 가드라 actionability가 막지 않는다 — 부재 단언이 필수.
// 캡처 관문(captureOwnedTab)이 tab.active를 재확인하므로 fixture를 앞에 두고 evaluate 클릭한다.
export async function proceedToDrafting(panel: Page, fixture: Page): Promise<void> {
  const next = panel.getByTestId("next-step");
  const drafting = panel.getByTestId("drafting-panel");
  // captureVisibleTab quota(~2회/초)는 확장 전역이라 spec 경계를 넘는다 — 버스트 금지,
  // 1초 이상 간격으로 재시도한다(captureUntilDrafting 관례).
  await expect(async () => {
    if (!(await drafting.isVisible())) {
      await expect(next).not.toHaveAttribute("aria-disabled", "true");
      await fixture.bringToFront();
      await next.evaluate((el) => (el as HTMLElement).click());
    }
    await expect(drafting).toBeVisible({ timeout: 2500 });
  }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 25_000 });
}
