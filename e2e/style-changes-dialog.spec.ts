import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  expect,
  pickElement,
  setQuadLinkedValue,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// design.md 16개 체크 목록(1차 출처)을 순서 그대로 이식 — 상태 연속 serial 플로우.
test.describe.serial("style-changes-dialog", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  const trigger = () => panel.getByTestId("changes-trigger");
  const dialog = () => panel.getByTestId("changes-dialog");
  const card = (source: "current" | "buffered") =>
    panel.locator(`[data-testid="changes-card"][data-source="${source}"]`);
  const row = (source: "current" | "buffered", prop: string) =>
    card(source).locator(`[data-testid="changes-row"][data-prop="${prop}"]`);

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
    // 버퍼 스냅샷 캡처가 끝나야 startPicker가 발송된다 — SelectedPanel 언마운트(repick 소실)가 신호.
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, selector);
  }

  test("1. 변경 0건 → 트리거 비활성 + badge 없음", async () => {
    await enterDebugAndPick(fixture, panel, "#title");

    await expect(trigger()).toBeDisabled();
    expect(await trigger().innerText()).not.toMatch(/\d/);
  });

  test("2. 속성 1개 수정 → 트리거 활성 + badge 1", async () => {
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(255, 0, 0)");
    await expect(trigger()).toBeEnabled();
    await expect(trigger()).toContainText("1");
  });

  test("3. 요소 A(color+padding 4면 동일값) + 요소 B(class) → badge 3 (padding collapse)", async () => {
    await setQuadLinkedValue(panel, "padding", "20px");
    await repickTo("#card");
    await expect(panel.getByTestId("class-editor")).toHaveValue("card box");
    await panel.getByTestId("class-editor").fill("card box extra");
    await expect(trigger()).toContainText("3");
  });

  test("4. 다이얼로그 카드 2장·행 3개 (source·selector 표기)", async () => {
    await openDialog();
    await expect(panel.getByTestId("changes-card")).toHaveCount(2);
    await expect(panel.getByTestId("changes-row")).toHaveCount(3);
    await expect(card("buffered")).toHaveCount(1);
    await expect(card("current")).toHaveCount(1);
    await expect(card("buffered")).toHaveAttribute("data-selector", /.+/);
    await expect(card("current")).toHaveAttribute("data-selector", /.+/);
  });

  test("5. 현재 요소 행 초기화 → 페이지 즉시 원복 + badge 감소", async () => {
    await row("current", "class").getByTestId("reset-row").click();
    await expect(fixture.locator("#card")).toHaveClass("card box");
    await expect(trigger()).toContainText("2");
    await expect(panel.getByTestId("changes-card")).toHaveCount(1);
  });

  test("6. 버퍼 요소 행 초기화 → 페이지 원복 + 재캡처 에러 없음", async () => {
    await row("buffered", "color").getByTestId("reset-row").click();
    await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(17, 24, 39)");
    // 재캡처 완료는 busy 해제(잔여 행 갱신)로 간접 단언 — afterImage 정합은 수동 잔여.
    await expect(panel.getByTestId("changes-row")).toHaveCount(1);
    await expect(trigger()).toContainText("1");
  });

  test("7. 버퍼 요소 마지막 행 초기화 → 카드 사라짐(버퍼 제거)", async () => {
    // 다이얼로그가 0건 자동 닫힘으로 끝나지 않도록 현재 요소에 변경을 하나 더 만든다.
    await closeDialog();
    await typeStyleValue(panel, "width", "300px");
    await openDialog();
    await row("buffered", "padding").getByTestId("reset-row").click();
    await expect(card("buffered")).toHaveCount(0);
    await expect(panel.getByTestId("changes-card")).toHaveCount(1);
    await expect(dialog()).toBeVisible();
  });

  test("8. 카드 [↺](버퍼) → 재확인 없이 요소 전체 원복 + 카드 제거", async () => {
    await closeDialog();
    await repickTo("#title");
    await typeStyleValue(panel, "color", "#00ff00");
    await openDialog();
    await card("buffered").getByTestId("reset-element").click();
    await expect(panel.getByRole("alertdialog")).toHaveCount(0);
    await expect(card("buffered")).toHaveCount(0);
    await expect(fixture.locator("#card")).not.toHaveCSS("width", "300px");
  });

  test("9. 카드 [↺](현재 선택) → styleEdits 원복 + 선택 유지", async () => {
    await closeDialog();
    await repickTo("#card");
    await panel.getByTestId("class-editor").fill("card box extra2");
    await openDialog();
    await card("current").getByTestId("reset-element").click();
    await expect(card("current")).toHaveCount(0);
    await expect(fixture.locator("#card")).toHaveClass("card box");
    await expect(trigger()).toContainText("1");
    // 선택 유지 — SelectedPanel 그대로 + 인풋 원복
    await closeDialog();
    await expect(panel.getByTestId("repick")).toBeVisible();
    await expect(panel.getByTestId("class-editor")).toHaveValue("card box");
  });

  test("10. 마지막 변경 항목 초기화 → 다이얼로그 자동 닫힘 + 트리거 비활성", async () => {
    await openDialog();
    await row("buffered", "color").getByTestId("reset-row").click();
    await expect(dialog()).toBeHidden();
    await expect(trigger()).toBeDisabled();
  });

  test("11. [전체 초기화] → confirm → 전 요소 원복 + 닫힘 + 선택 유지", async () => {
    await panel.getByTestId("class-editor").fill("card box extra3");
    await repickTo("#title");
    await typeStyleValue(panel, "color", "#0000ff");
    await openDialog();
    await panel.getByTestId("reset-all").click();
    await panel.getByTestId("reset-all-confirm").click();
    await expect(dialog()).toBeHidden();
    await expect(trigger()).toBeDisabled();
    await expect(fixture.locator("#card")).toHaveClass("card box");
    await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(17, 24, 39)");
    await expect(panel.getByTestId("repick")).toBeVisible();
  });

  test("12. text 행 초기화 동작", async () => {
    await panel.getByTestId("text-editor").fill("Changed Title");
    await expect(fixture.locator("#title")).toHaveText("Changed Title");
    await openDialog();
    await row("current", "text").getByTestId("reset-row").click();
    await expect(fixture.locator("#title")).toHaveText("Fixture Title");
    // 마지막 항목이라 0건 reactive 자동 닫힘
    await expect(dialog()).toBeHidden();
  });

  test("13. class 행 초기화 동작", async () => {
    await panel.getByTestId("class-editor").fill("highlight");
    await expect(fixture.locator("#title")).toHaveClass(/highlight/);
    await openDialog();
    await row("current", "class").getByTestId("reset-row").click();
    await expect(fixture.locator("#title")).not.toHaveClass(/highlight/);
    await expect(dialog()).toBeHidden();
  });

  test("14. reload 세션 복원 후 소실 요소 행 초기화 → store 항목 제거 + 에러 없음", async () => {
    await typeStyleValue(panel, "color", "#ff00ff");
    await repickTo("#card");
    await panel.getByTestId("class-editor").fill("card box extra4");
    await fixture.reload();
    // 세션 복원 후 버퍼 요소를 DOM에서 제거해 소실 상태를 만든다.
    await fixture.evaluate(() => document.querySelector("#title")?.remove());
    await panel.bringToFront();
    await openDialog();
    await card("buffered").getByTestId("reset-row").click();
    await expect(card("buffered")).toHaveCount(0);
    await expect(card("current")).toHaveCount(1);
    await expect(dialog()).toBeVisible();
  });

  test("15. 행 [↺] 빠른 연속 클릭 → 중복 실행 없음", async () => {
    await closeDialog();
    await typeStyleValue(panel, "width", "320px");
    await openDialog();
    const resetBtn = row("current", "width").getByTestId("reset-row");
    await resetBtn.click();
    // busy 가드 검증 — 두 번째 클릭은 no-op이어야 한다 (detach됐으면 무시).
    await resetBtn.click({ force: true, timeout: 1_000 }).catch(() => {});
    await expect(row("current", "width")).toHaveCount(0);
    await expect(row("current", "class")).toHaveCount(1);
    await expect(trigger()).toContainText("1");
  });

  test("16. 같은 페이지 reload → 세션 보존 / cross-page 이동 → 폐기 + reactive 닫힘", async ({
    ext,
  }) => {
    await closeDialog();
    await fixture.reload();
    await panel.bringToFront();
    await expect(trigger()).toContainText("1");

    await openDialog();
    await fixture.goto(ext.fixtureUrl("second.html"));
    const expired = panel.getByRole("alertdialog");
    await expect(expired).toBeVisible();
    await expired.getByRole("button").click();
    await expect(panel.getByTestId("changes-dialog")).toBeHidden();
    await expect(panel.getByTestId("mode-element")).toBeVisible();
  });
});
