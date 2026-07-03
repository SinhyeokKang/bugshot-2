import type { Page } from "@playwright/test";
import {
  enterDebug,
  expect,
  pickElement,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// picker all_frames 지원 — 1-depth iframe 내부 요소 선택·편집·버퍼 분리·teardown.
// 캡처(크롭 좌표 정확도·top overlay 미포함)는 captureVisibleTab flaky로 수동 잔여(GOTCHAS).

const OVERLAY_ID = "__bugshot_picker_host";

function overlayInTop(fixture: Page): Promise<boolean> {
  return fixture.evaluate(
    (id) => !!document.getElementById(id),
    OVERLAY_ID,
  );
}

function overlayInFrame(fixture: Page, urlPart: RegExp): Promise<boolean> {
  const frame = fixture.frame({ url: urlPart });
  if (!frame) return Promise.resolve(false);
  return frame.evaluate((id) => !!document.getElementById(id), OVERLAY_ID);
}

test.describe.serial("picker-iframe (same-origin)", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("iframe.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  async function repickTo(selector: string, frame?: string) {
    await panel.getByTestId("repick").click();
    // 버퍼 스냅샷 캡처가 끝나야 startPicker가 발송된다 — repick 소실이 신호.
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, selector, { frame });
  }

  test("1. picking 중 iframe에서 ESC → 전 프레임 picker 정리 + idle", async () => {
    await enterDebug(panel);
    await panel.getByTestId("mode-element").click();

    // picker.start broadcast로 top·iframe 양쪽에 overlay가 깔린다.
    await expect.poll(() => overlayInTop(fixture)).toBe(true);
    await expect.poll(() => overlayInFrame(fixture, /basic\.html/)).toBe(true);

    // iframe 문서에 ESC — 발화 프레임만 idle이 되면 top이 유령으로 남는다(teardown 검증).
    await fixture.frameLocator("#frame").locator("body").press("Escape");

    await expect(panel.getByTestId("mode-element")).toBeVisible();
    // clearPicker broadcast로 top·iframe overlay 모두 제거.
    await expect.poll(() => overlayInTop(fixture)).toBe(false);
    await expect.poll(() => overlayInFrame(fixture, /basic\.html/)).toBe(false);
  });

  test("2. iframe 내부 요소 선택 → 스타일 에디터 로드", async () => {
    await panel.getByTestId("mode-element").click();
    await pickElement(fixture, panel, "#title", { frame: "#frame" });
    await expect(panel.getByTestId("repick")).toBeVisible();
  });

  test("3. color 편집 → iframe 내부 DOM에 반영", async () => {
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(
      fixture.frameLocator("#frame").locator("#title"),
    ).toHaveCSS("color", "rgb(255, 0, 0)");
  });

  test("4. top 요소 재선택 → 두 편집이 버퍼에 각각 유지 + same-origin은 배지 없음", async () => {
    await repickTo("#top-title");
    await typeStyleValue(panel, "width", "222px");
    await expect(fixture.locator("#top-title")).toHaveCSS("width", "222px");
    // iframe 편집은 버퍼로 내려가 그대로 유지.
    await expect(
      fixture.frameLocator("#frame").locator("#title"),
    ).toHaveCSS("color", "rgb(255, 0, 0)");

    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();
    await expect(panel.getByTestId("changes-card")).toHaveCount(2);
    // same-origin iframe은 페이지 origin과 같아 출처 배지를 만들지 않는다.
    await expect(panel.getByTestId("origin-badge")).toHaveCount(0);
  });

  test("5. 버퍼(iframe) 행 초기화 → iframe 프레임 DOM 원복 (frameId 라우팅)", async () => {
    const bufferedRow = panel
      .locator('[data-testid="changes-card"][data-source="buffered"]')
      .locator('[data-testid="changes-row"][data-prop="color"]');
    await bufferedRow.getByTestId("reset-row").click();

    await expect(
      fixture.frameLocator("#frame").locator("#title"),
    ).toHaveCSS("color", "rgb(17, 24, 39)");
    await expect(panel.getByTestId("changes-card")).toHaveCount(1);
  });
});

test.describe.serial("picker-iframe (cross-origin)", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("cross-origin.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("1. cross-origin iframe 내부 요소 선택·편집 → 해당 프레임 DOM 반영", async () => {
    await enterDebug(panel);
    await panel.getByTestId("mode-element").click();
    await pickElement(fixture, panel, "#title", { frame: "#xframe" });
    await expect(panel.getByTestId("repick")).toBeVisible();

    await typeStyleValue(panel, "color", "#00ff00");
    await expect(
      fixture.frameLocator("#xframe").locator("#title"),
    ).toHaveCSS("color", "rgb(0, 255, 0)");
  });

  test("2. top의 동일 selector(#title) 재선택 → 별개 요소로 분리 + iframe 카드만 출처 배지", async () => {
    // cross-origin.html top에도 h1#title이 있다 — 동일 selector가 프레임 축으로 갈리는 케이스.
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#title");

    await typeStyleValue(panel, "width", "250px");
    await expect(fixture.locator("#title")).toHaveCSS("width", "250px");
    // iframe 편집은 top 편집에 오염되지 않고 유지.
    await expect(
      fixture.frameLocator("#xframe").locator("#title"),
    ).toHaveCSS("color", "rgb(0, 255, 0)");

    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();
    // 복합키가 깨지면 iframe 버퍼가 top 선택으로 승격돼 카드가 1장으로 붕괴한다.
    await expect(panel.getByTestId("changes-card")).toHaveCount(2);
    // 출처 배지는 cross-origin iframe 카드에만 — localhost 호스트 표기.
    await expect(panel.getByTestId("origin-badge")).toHaveCount(1);
    await expect(panel.getByTestId("origin-badge")).toContainText("localhost");
  });

  test("3. 버퍼(cross-origin) 행 초기화 → cross-origin 프레임 DOM 원복", async () => {
    const bufferedRow = panel
      .locator('[data-testid="changes-card"][data-source="buffered"]')
      .locator('[data-testid="changes-row"][data-prop="color"]');
    await bufferedRow.getByTestId("reset-row").click();

    await expect(
      fixture.frameLocator("#xframe").locator("#title"),
    ).toHaveCSS("color", "rgb(17, 24, 39)");
    await expect(panel.getByTestId("changes-card")).toHaveCount(1);
  });
});
