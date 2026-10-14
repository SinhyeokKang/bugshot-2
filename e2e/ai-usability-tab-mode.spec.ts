import type { Page } from "@playwright/test";

import {
  enterDebug,
  expect,
  pickElement,
  setQuadLinkedValue,
  test,
  typeStyleValue,
  waitForPanelFront,
  type ExtContext,
} from "./fixtures/extension";
import { PANEL_PATH, parsePanelTabTarget } from "../src/lib/panel-tab-url";

// 같은 창 탭 모드(e2e의 openPanel이 곧 탭 모드다). 패널이 캡처 동안 대상 탭을 스스로 앞으로
// 가져왔다가 돌아오고(hold), 대상 ↔ 자기 패널 탭 전환으론 대상의 레코더가 멈추지 않는다.
// 이 spec은 캡처 트리거용 우회(fixture bringToFront + DOM 클릭)를 쓰지 않는다 — 패널 버튼만 누른다.
// bringToFront는 "사용자가 다른 탭으로 간다"를 흉내 낼 때만 쓴다.

const FIXTURE_URL = "http://127.0.0.1/basic.html";

async function openTabMode(ext: ExtContext) {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  // openPanel 전에 잡는다 — 패널을 연 뒤엔 그 탭이 앞이라 순서가 섞이면 상태가 갈린다.
  const tabId = await ext.fixtureTabId(FIXTURE_URL);
  const panel = await ext.openPanel(tabId);
  return { fixture, tabId, panel };
}

// hasText는 대소문자 무시 부분 일치다 — 마커끼리 접두가 겹치지 않게 단어로 둔다.
function consoleEntry(panel: Page, marker: string) {
  return panel.locator("[data-entry-id]", { hasText: marker });
}

// console 서브탭에 레코더가 붙을 때까지 마커를 찍는다(arm은 비동기).
async function waitForRecorder(fixture: Page, panel: Page): Promise<void> {
  await panel.getByTestId("subtab-console").click();
  await expect(panel.getByTestId("subtab-console")).toHaveAttribute("data-state", "active");
  await expect(async () => {
    await fixture.evaluate(() => console.log("bugshot-e2e-tm-armed", performance.now()));
    await panel.waitForTimeout(1700);
    await expect(consoleEntry(panel, "bugshot-e2e-tm-armed")).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });
}

async function isActive(ext: ExtContext, tabId: number): Promise<boolean> {
  return ext.evalInExt((id: number) => chrome.tabs.get(id).then((t) => t.active), tabId);
}

// 이미지에서 조건을 만족하는 픽셀 수 — 캡처가 fixture 화면인지(패널 오캡처가 아닌지) 색으로 판정한다.
async function countPixels(
  panel: Page,
  testId: string,
  kind: "red" | "title",
  index = 0,
): Promise<number> {
  return panel
    .getByTestId(testId)
    .nth(index)
    .evaluate(async (el, k) => {
      const img = el as HTMLImageElement;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        // red: #ff0000로 바꾼 글자. title: #title 기본색 rgb(17,24,39) 근방(안티앨리어싱 여유).
        if (k === "red" ? r > 200 && g < 70 && b < 70 : r < 60 && g < 60 && b > 25 && b < 90)
          n++;
      }
      return n;
    }, kind);
}

async function proceedToDrafting(panel: Page): Promise<void> {
  const next = panel.getByTestId("next-step");
  const drafting = panel.getByTestId("drafting-panel");
  await expect(async () => {
    await waitForPanelFront(panel);
    if (!(await drafting.isVisible())) {
      await expect(next).not.toHaveAttribute("aria-disabled", "true");
      await next.click();
    }
    await expect(drafting).toBeVisible({ timeout: 4000 });
  }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 25_000 });
}

test.describe.serial("탭 모드(같은 창) — 대상 탭 hold·레코더 유지", () => {
  // background의 정지 예외는 SW가 getContexts로 받은 패널 탭 documentUrl(쿼리 포함)에 기대고,
  // 배선 단위 테스트는 그 응답 모양을 mock으로 가정한다 — 실제 Chrome이 그 모양을 주는지 여기서 본다.
  test("getContexts가 패널 탭의 쿼리 포함 documentUrl을 돌려준다", async ({ ext }) => {
    const { fixture, tabId, panel } = await openTabMode(ext);
    try {
      const panelTabId = await panel.evaluate(async () => (await chrome.tabs.getCurrent())?.id);
      expect(typeof panelTabId).toBe("number");
      const ctxs = await ext.evalInExt(() => chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] }));
      const mine = ctxs.find((c) => c.tabId === panelTabId);
      const base = `chrome-extension://${ext.extensionId}/${PANEL_PATH}`;
      expect(parsePanelTabTarget(mine?.documentUrl, base)).toBe(tabId);
    } finally {
      await panel.close();
      await fixture.close();
    }
  });

  test("S1 대상 ↔ 패널 왕복 뒤에도 기록이 이어지고, 뷰포트 캡처가 대상 화면으로 끝난다", async ({
    ext,
  }) => {
    const { fixture, tabId, panel } = await openTabMode(ext);
    try {
      await enterDebug(panel);
      await waitForRecorder(fixture, panel);

      await fixture.bringToFront();
      await fixture.evaluate(() => console.log("bugshot-e2e-tm-alpha"));
      await panel.bringToFront();
      await fixture.bringToFront();
      await fixture.evaluate(() => console.log("bugshot-e2e-tm-bravo"));
      await panel.bringToFront();
      // 대상 → 자기 패널 전환은 대상 레코더를 멈추지 않는다 — 왕복 뒤의 B까지 쌓인다.
      await expect(consoleEntry(panel, "bugshot-e2e-tm-alpha")).not.toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(consoleEntry(panel, "bugshot-e2e-tm-bravo")).not.toHaveCount(0, {
        timeout: 15_000,
      });

      await panel.getByTestId("subtab-issue").click();
      const drafting = panel.getByTestId("drafting-panel");
      await expect(async () => {
        await waitForPanelFront(panel);
        if (!(await drafting.isVisible())) {
          await panel.getByTestId("mode-screenshot").click();
          const viewport = panel.getByTestId("capture-method-viewport");
          await expect(viewport).not.toHaveAttribute("aria-disabled", "true");
          await viewport.click();
        }
        await expect(drafting).toBeVisible({ timeout: 4000 });
      }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 30_000 });
      // 캡처가 끝나면 패널이 스스로 돌아온다.
      await waitForPanelFront(panel);
      expect(await isActive(ext, tabId)).toBe(false);

      const vp = await fixture.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      const aspect = await panel
        .getByTestId("media-preview-img")
        .evaluate(async (el) => {
          const img = el as HTMLImageElement;
          await img.decode();
          return img.naturalWidth / img.naturalHeight;
        });
      expect(aspect).toBeCloseTo(vp.w / vp.h, 1);
      expect(await countPixels(panel, "media-preview-img", "title")).toBeGreaterThan(0);

      await panel.getByTestId("log-attachment-card").click();
      const dialog = panel.getByTestId("log-preview-dialog");
      await expect(dialog).toBeVisible();
      await panel.getByTestId("log-preview-tab-console").click();
      await expect(dialog.locator("[data-entry-id]:visible", { hasText: "bugshot-e2e-tm-alpha" })).toHaveCount(1);
      await expect(dialog.locator("[data-entry-id]:visible", { hasText: "bugshot-e2e-tm-bravo" })).toHaveCount(1);
    } finally {
      await panel.close();
      await fixture.close();
    }
  });

  test("S2 요소 편집 — picking이 대상을 앞으로, before 뒤 패널 복귀, before/after 모두 대상 화면", async ({
    ext,
  }) => {
    const { fixture, tabId, panel } = await openTabMode(ext);
    try {
      await enterDebug(panel);
      await panel.getByTestId("mode-element").click();
      await expect.poll(() => isActive(ext, tabId)).toBe(true);

      // pickElement는 before 캡처가 끝나 패널이 돌아올 때까지 기다린다.
      await pickElement(fixture, panel, "#title");
      expect(await isActive(ext, tabId)).toBe(false);

      await typeStyleValue(panel, "color", "#ff0000");
      await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(255, 0, 0)");
      await proceedToDrafting(panel);
      await waitForPanelFront(panel);

      await expect(panel.getByTestId("snapshot-before")).toBeVisible();
      await expect(panel.getByTestId("snapshot-after")).toBeVisible();
      expect(await countPixels(panel, "snapshot-before", "title")).toBeGreaterThan(0);
      expect(await countPixels(panel, "snapshot-before", "red")).toBe(0);
      expect(await countPixels(panel, "snapshot-after", "red")).toBeGreaterThan(0);
    } finally {
      await panel.close();
      await fixture.close();
    }
  });

  // 재캡처가 거부되면 결과가 null이라 버퍼의 옛 after(빨간 글자)가 그대로 남는다 — 그래서
  // "No snapshot이 아님"이 아니라 after에 빨강이 사라졌는지로 재캡처 성공을 판정한다.
  test("diff 재캡처 — 버퍼 요소 행을 초기화하면 after가 대상 화면으로 다시 찍힌다", async ({
    ext,
  }) => {
    const { fixture, panel } = await openTabMode(ext);
    try {
      await enterDebug(panel);
      await panel.getByTestId("mode-element").click();
      await pickElement(fixture, panel, "#title");
      await typeStyleValue(panel, "color", "#ff0000");
      await setQuadLinkedValue(panel, "padding", "20px");
      await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(255, 0, 0)");

      await panel.getByTestId("repick").click();
      await expect(panel.getByTestId("repick")).toBeHidden();
      await pickElement(fixture, panel, "#card");
      await panel.getByTestId("class-editor").fill("card box extra");

      await panel.getByTestId("changes-trigger").click();
      const dialog = panel.getByTestId("changes-dialog");
      await expect(dialog).toBeVisible();
      const buffered = panel.locator('[data-testid="changes-card"][data-source="buffered"]');
      await buffered
        .locator('[data-testid="changes-row"][data-prop="color"]')
        .getByTestId("reset-row")
        .click();
      await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(17, 24, 39)");
      await expect(buffered.getByTestId("changes-row")).toHaveCount(1);
      await waitForPanelFront(panel);
      await panel.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await proceedToDrafting(panel);
      const afters = panel.getByTestId("snapshot-after");
      await expect(afters).toHaveCount(2);
      for (let i = 0; i < 2; i++) {
        expect(await countPixels(panel, "snapshot-after", "red", i)).toBe(0);
      }
      await expect(panel.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
    } finally {
      await panel.close();
      await fixture.close();
    }
  });

  test("패널 → 제3 탭으로 가도 대상은 계속 기록된다", async ({ ext }) => {
    const { fixture, panel } = await openTabMode(ext);
    const third = await ext.context.newPage();
    try {
      await panel.bringToFront();
      await enterDebug(panel);
      await waitForRecorder(fixture, panel);

      await third.bringToFront();
      await fixture.evaluate(() => console.log("bugshot-e2e-tm-charlie"));
      await panel.bringToFront();
      await expect(consoleEntry(panel, "bugshot-e2e-tm-charlie")).not.toHaveCount(0, {
        timeout: 15_000,
      });
    } finally {
      await third.close();
      await panel.close();
      await fixture.close();
    }
  });

  test("대상 → 제3 탭으로 곧장 가면 대상 기록이 멈춘다(기존 계약)", async ({ ext }) => {
    const { fixture, panel } = await openTabMode(ext);
    const third = await ext.context.newPage();
    try {
      await panel.bringToFront();
      await enterDebug(panel);
      await waitForRecorder(fixture, panel);

      await fixture.bringToFront();
      await third.bringToFront();
      await fixture.evaluate(() => console.log("bugshot-e2e-tm-delta"));
      await panel.bringToFront();
      // 바로 앞 케이스에서 같은 경로(숨은 대상 → 패널 복귀)의 마커는 수 초 안에 도착한다 — 그보다
      // 넉넉히 기다린 뒤에도 없으면 정지 때문이다. 패널 복귀의 visibilitychange 재무장은 e2e에선
      // 오지 않는다(Playwright 포커스 에뮬레이션 — GOTCHAS "탭 모드 hold").
      await panel.waitForTimeout(6000);
      await expect(consoleEntry(panel, "bugshot-e2e-tm-delta")).toHaveCount(0);
    } finally {
      await third.close();
      await panel.close();
      await fixture.close();
    }
  });

  test("별도 창 탭 모드 — 뷰포트 캡처가 성공하고 대상 창의 활성 탭을 건드리지 않는다", async ({
    ext,
  }) => {
    const { fixture, tabId, panel } = await openTabMode(ext);
    try {
      const panelTabId = await panel.evaluate(async () => (await chrome.tabs.getCurrent())!.id!);
      await ext.evalInExt((id: number) => chrome.windows.create({ tabId: id }), panelTabId);
      // 대상 창에서 fixture를 앞에 둔다 — 별도 창이면 양쪽이 이미 보여 handoff가 없다.
      await fixture.bringToFront();
      const fixtureWindow = await ext.evalInExt(
        (id: number) => chrome.tabs.get(id).then((t) => t.windowId),
        tabId,
      );
      const activeIn = () =>
        ext.evalInExt(
          (w: number) => chrome.tabs.query({ active: true, windowId: w }).then((t) => t[0]?.id),
          fixtureWindow,
        );
      expect(await activeIn()).toBe(tabId);

      await enterDebug(panel);
      const drafting = panel.getByTestId("drafting-panel");
      await expect(async () => {
        if (!(await drafting.isVisible())) {
          await panel.getByTestId("mode-screenshot").click();
          const viewport = panel.getByTestId("capture-method-viewport");
          await expect(viewport).not.toHaveAttribute("aria-disabled", "true");
          await viewport.click();
        }
        await expect(drafting).toBeVisible({ timeout: 4000 });
      }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 30_000 });

      expect(await activeIn()).toBe(tabId);
      expect(await countPixels(panel, "media-preview-img", "title")).toBeGreaterThan(0);
    } finally {
      await panel.close();
      await fixture.close();
    }
  });
});
