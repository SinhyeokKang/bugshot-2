import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  expect,
  pickElement,
  selectStyleValue,
  setAlignment,
  setQuadLinkedValue,
  setQuadSideValue,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// 전수 검수: 모든 editor 타입(TextProp·SelectProp·AlignmentProp·QuadProp·GapPair·Radius·
// BoxShadow·class)을 여러 요소에 누적(2·3·4개)해 변경사항 목록·shorthand collapse·
// 버퍼 보존·재선택 복원을 한 번에 검증한다.
test.describe.serial("style-changes-stacked", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  const trigger = () => panel.getByTestId("changes-trigger");
  const dialog = () => panel.getByTestId("changes-dialog");
  const card = (source: "current" | "buffered") =>
    panel.locator(`[data-testid="changes-card"][data-source="${source}"]`);
  const propRowAll = (prop: string) =>
    panel.locator(`[data-testid="changes-row"][data-prop="${prop}"]`);

  async function openDialog() {
    await trigger().click();
    await expect(dialog()).toBeVisible();
  }
  async function closeDialog() {
    await panel.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  }
  async function repickTo(selector: string) {
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, selector);
    await expect(panel.getByTestId("repick")).toBeVisible();
  }

  test("1. #el1 — 스타일 2개 누적 (TextProp color + SelectProp display)", async () => {
    await enterDebugAndPick(fixture, panel, "#el1");
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(fixture.locator("#el1")).toHaveCSS("color", "rgb(255, 0, 0)");
    await selectStyleValue(panel, "display", "inline-block");
    await expect(fixture.locator("#el1")).toHaveCSS("display", "inline-block");
    await expect(trigger()).toContainText("2");

    await openDialog();
    await expect(card("current")).toHaveCount(1);
    await expect(card("current").locator('[data-prop="color"]')).toHaveCount(1);
    await expect(card("current").locator('[data-prop="display"]')).toHaveCount(1);
    await closeDialog();
  });

  test("2. #el2 — 스타일 3개 누적 (QuadProp padding collapse + bg + Radius collapse)", async () => {
    await repickTo("#el2");
    await setQuadLinkedValue(panel, "padding", "20px");
    await typeStyleValue(panel, "bg-color", "#0000ff");
    await setQuadLinkedValue(panel, "radius", "16px");

    await expect(fixture.locator("#el2")).toHaveCSS("padding", "20px");
    await expect(fixture.locator("#el2")).toHaveCSS("background-color", "rgb(0, 0, 255)");

    // 버퍼 #el1(2) + 현재 #el2(3) = 5
    await expect(trigger()).toContainText("5");
    await openDialog();
    await expect(panel.getByTestId("changes-card")).toHaveCount(2);
    // collapse: padding/border-radius는 단일 행, 개별 longhand 없음
    await expect(propRowAll("padding")).toHaveCount(1);
    await expect(propRowAll("border-radius")).toHaveCount(1);
    await expect(propRowAll("padding-top")).toHaveCount(0);
    await expect(propRowAll("border-top-left-radius")).toHaveCount(0);
    await expect(card("current").locator('[data-prop="background-color"]')).toHaveCount(1);
    await closeDialog();
  });

  test("3. #el3 — 스타일 4개 누적 (단면 margin + GapPair + Alignment + BoxShadow)", async () => {
    await repickTo("#el3");
    await setQuadSideValue(panel, "margin", 0, "24px"); // margin-top만 (collapse 안 됨)
    await setQuadSideValue(panel, "gap", 0, "8px"); // row-gap
    await setAlignment(panel, "text-align", 1); // center
    await typeStyleValue(panel, "box-shadow", "0px 4px 8px rgba(0, 0, 0, 0.5)");

    await expect(fixture.locator("#el3")).toHaveCSS("margin-top", "24px");
    await expect(fixture.locator("#el3")).toHaveCSS("text-align", "center");

    // 버퍼 #el1(2)+#el2(3)+현재 #el3(4) = 9
    await expect(trigger()).toContainText("9");
    await openDialog();
    await expect(panel.getByTestId("changes-card")).toHaveCount(3);
    await expect(card("current").locator('[data-prop="margin-top"]')).toHaveCount(1);
    await expect(card("current").locator('[data-prop="row-gap"]')).toHaveCount(1);
    await expect(card("current").locator('[data-prop="text-align"]')).toHaveCount(1);
    await expect(card("current").locator('[data-prop="box-shadow"]')).toHaveCount(1);
    // margin은 단면만이라 collapse 안 됨 — shorthand "margin" 행 없음
    await expect(propRowAll("margin")).toHaveCount(0);
    await closeDialog();
  });

  test("4. 버퍼된 #el2 재선택 → 편집 복원 + width 추가 + padding 한 면 변경 → 전부 보존", async () => {
    await repickTo("#el2");
    // 복원 확인: padding/bg/radius가 편집으로 살아있어야 width 추가 후에도 함께 보존된다
    await typeStyleValue(panel, "width", "320px");
    await setQuadSideValue(panel, "padding", 0, "40px"); // padding-top만 40 → collapse 해제
    await expect(fixture.locator("#el2")).toHaveCSS("padding-top", "40px");
    await expect(fixture.locator("#el2")).toHaveCSS("padding-left", "20px");

    // 다음 요소로 넘어가 #el2 재버퍼
    await repickTo("#el1");
    await openDialog();
    const el2 = panel
      .locator('[data-testid="changes-card"][data-source="buffered"]')
      .filter({ has: panel.locator('[data-prop="width"]') });
    await expect(el2).toHaveCount(1);
    // padding collapse 해제 → 4 longhand 개별, top=40 나머지=20
    await expect(el2.locator('[data-prop="padding-top"]')).toHaveCount(1);
    await expect(el2.locator('[data-prop="padding-right"]')).toHaveCount(1);
    await expect(el2.locator('[data-prop="padding-bottom"]')).toHaveCount(1);
    await expect(el2.locator('[data-prop="padding-left"]')).toHaveCount(1);
    await expect(el2.locator('[data-prop="padding"]')).toHaveCount(0);
    // 복원된 bg·radius도 보존
    await expect(el2.locator('[data-prop="background-color"]')).toHaveCount(1);
    await expect(el2.locator('[data-prop="border-radius"]')).toHaveCount(1);
    await closeDialog();
  });

  test("5. class editor — 클래스 추가 행 + 버퍼 보존 + 기존 스타일 as-is 베이스라인 보존", async () => {
    // #el1 현재 선택 상태 (4번 끝에서 repick #el1). color는 1번에서 편집됨(rgb(255,0,0)).
    await panel.getByTestId("class-editor").fill("swatch active");
    await expect(fixture.locator("#el1")).toHaveClass("swatch active");
    await openDialog();
    const classRow = card("current").locator('[data-prop="class"]');
    await expect(classRow).toHaveCount(1);
    // 토큰 diff 볼드: 추가된 "active"만 강조(<strong>), 공통 "swatch"는 평문. as-is는 강조 없음.
    await expect(classRow.getByTestId("changes-tobe").locator("strong")).toHaveCount(1);
    await expect(classRow.getByTestId("changes-tobe").locator("strong")).toHaveText("active");
    await expect(classRow.getByTestId("changes-asis").locator("strong")).toHaveCount(0);
    // 회귀: class 편집이 유발한 selectionUpdated가 color 행의 as-is(원본)를 편집값으로 덮으면 안 됨
    const colorRow = card("current").locator('[data-prop="color"]');
    const asIs = (await colorRow.getByTestId("changes-asis").innerText()).trim();
    const toBe = (await colorRow.getByTestId("changes-tobe").innerText()).trim();
    expect(asIs).not.toBe(toBe);
    expect(asIs).toBe("rgb(50, 50, 50)");
    await closeDialog();
  });

  test("6. 버퍼 #el2 재선택 후 class 편집 → 기존 bg 행 as-is 베이스라인 보존", async () => {
    await repickTo("#el2");
    // class 편집 → selectionUpdated 유발. bg(2번에서 rgb(0,0,255)로 편집)의 as-is가 오염되면 안 됨.
    await panel.getByTestId("class-editor").fill("swatch wide");
    await openDialog();
    const bgRow = card("current").locator('[data-prop="background-color"]');
    const asIs = (await bgRow.getByTestId("changes-asis").innerText()).trim();
    const toBe = (await bgRow.getByTestId("changes-tobe").innerText()).trim();
    expect(asIs).not.toBe(toBe);
    expect(asIs).toBe("rgb(240, 240, 240)");
    await closeDialog();
  });
});
