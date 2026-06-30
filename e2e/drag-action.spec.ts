import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 드래그 액션 기록 — precision-first 두 경로 + click 회귀.
// 진입로는 action-log-coverage와 동일(Replay 캡처 → drafting(video) → action-log-card).
// 판정은 i18n 무관한 data-kind + data-drag-target(0=source-only/1=source+target) + 요소 접근성 이름 리터럴로.
//
// 함정: Playwright dragTo()/mouse.down→move→up은 pointer 이벤트만 쏴 네이티브 dragstart/drop을
// 발화하지 않는다(source-only로 떨어짐). 레코더가 isTrusted를 안 보므로 합성 DragEvent를 evaluate로
// dispatch해 source+target 경로를 재현한다. 포인터 경로는 실제 mouse 이동(steps)으로 재현.

async function setReplayEnabled(panel: Page, enabled: boolean): Promise<void> {
  await expect(async () => {
    await panel.getByTestId("tab-settings").click();
    await expect(panel.getByTestId("tab-settings")).toHaveAttribute("data-state", "active");
  }).toPass();
  await panel.getByTestId("settings-sub-issue").click();
  const sw = panel.locator('[id="replay-enabled"]');
  await expect(sw).toBeVisible();
  if (((await sw.getAttribute("data-state")) === "checked") !== enabled) {
    await sw.click();
  }
  await expect(sw).toHaveAttribute("data-state", enabled ? "checked" : "unchecked");
}

test.describe.serial("드래그 액션 기록 (포인터 source-only / 네이티브 source+target / click 회귀)", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("actions.html"));
    const tabId = await ext.fixtureTabId("http://127.0.0.1/actions.html");
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await setReplayEnabled(panel, false);
    await panel.close();
    await fixture.close();
  });

  test("네이티브 DnD=drag(출발+도착) / 포인터=drag(출발만) / 임계미달=click 정상", async () => {
    await setReplayEnabled(panel, true);
    await enterDebug(panel);
    await expect(panel.getByTestId("replay-button")).toBeVisible();

    // fixture front → Replay tick 프레임 버퍼. ready 먼저 확보(동작은 캡처 직전에).
    await fixture.bringToFront();
    await expect(async () => {
      await expect(panel.getByTestId("replay-button")).not.toHaveAttribute("aria-disabled", "true");
    }).toPass({ timeout: 45_000 });

    // ① 네이티브 HTML5 DnD — 합성 DragEvent(dragstart→dragover→drop→dragend). source+target 기록.
    await fixture.evaluate(() => {
      const src = document.getElementById("drag-native-src")!;
      const dropZone = document.getElementById("drag-native-zone")!;
      const dt = new DataTransfer();
      const opt = { bubbles: true, cancelable: true, dataTransfer: dt } as DragEventInit;
      src.dispatchEvent(new DragEvent("dragstart", opt));
      dropZone.dispatchEvent(new DragEvent("dragover", opt));
      dropZone.dispatchEvent(new DragEvent("drop", opt));
      src.dispatchEvent(new DragEvent("dragend", opt));
    });

    // ② 포인터 드래그 — source에서 임계(15px) 초과로 끌어 다른 요소 위에서 뗌. source-only 기록.
    const srcBox = (await fixture.locator("#drag-pointer-src").boundingBox())!;
    const zoneBox = (await fixture.locator("#drag-pointer-zone").boundingBox())!;
    await fixture.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await fixture.mouse.down();
    await fixture.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2, { steps: 12 });
    await fixture.mouse.up();

    // ③ 임계 미달 클릭(회귀) — 포인터 드래그가 남긴 suppressNextClick은 이 click의 pointerdown에서
    //    리셋돼 삼켜지지 않아야 한다. 드래그 기계 추가로 일반 click이 깨지지 않음을 click 기록으로 단언.
    await fixture.locator("#action-btn").click();

    // 캡처 트리거 → drafting(video) 전환
    await panel.bringToFront();
    await expect(panel.getByTestId("replay-button")).not.toHaveAttribute("aria-disabled", "true");
    await panel.getByTestId("replay-button").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible({ timeout: 45_000 });

    // 트림 오버레이가 drafting 위로 자동 등장 → 전체 구간 그대로 확정(no-op)으로 닫는다(z-50 덮음 회피).
    await expect(panel.getByTestId("replay-trim-overlay")).toBeVisible();
    const trimConfirm = panel.getByTestId("replay-trim-confirm");
    await expect(trimConfirm).toBeEnabled();
    await trimConfirm.click();
    await expect(panel.getByTestId("replay-trim-overlay")).toHaveCount(0);

    // action 로그 카드 → 다이얼로그
    const card = panel.getByTestId("action-log-card");
    await expect(card).toBeVisible();
    await card.click();

    // drag 총 2건(네이티브 1 + 포인터 1)
    await expect(panel.locator('[data-kind="drag"]')).toHaveCount(2);
    // 네이티브 DnD = source+target (data-drag-target="1"), 출발·도착 접근성 이름 둘 다 노출
    const native = panel.locator('[data-kind="drag"][data-drag-target="1"]');
    await expect(native).toHaveCount(1);
    await expect(native).toContainText("Draggable card");
    await expect(native).toContainText("Inbox dropzone");
    // 포인터 = source-only (data-drag-target="0"), 출발만. 도착 이름은 기록 안 됨.
    const pointer = panel.locator('[data-kind="drag"][data-drag-target="0"]');
    await expect(pointer).toHaveCount(1);
    await expect(pointer).toContainText("Pointer handle");
    await expect(pointer).not.toContainText("Pointer target");

    // click 회귀: 임계 미달 클릭은 정상 기록(드래그가 삼키지 않음). 드래그는 click으로 안 샌다.
    await expect(panel.locator('[data-kind="click"]')).toHaveCount(1);
    await expect(panel.locator('[data-kind="click"]')).toContainText("Submit Report");

    // 모달은 열린 채면 afterAll 탭 전환을 막는다 → Escape로 닫는다.
    await panel.keyboard.press("Escape");
    await expect(panel.locator('[data-kind="drag"]')).toHaveCount(0);
  });
});
