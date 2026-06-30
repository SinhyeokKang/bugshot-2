import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 액션 로그 커버리지 확장 — toggle/select/keypress 캡처 + click/toggle 이중기록 제거를 검증.
// action 로그 노출 경로는 Replay 캡처 → drafting(video) 한 가지뿐(replay-action-log.spec과 동일 진입로).
// trim 윈도우(30s cap) 안에 들도록 동작은 ready 확보 후·캡처 직전에 몰아서 수행한다.

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

test.describe.serial("action 로그 커버리지 (toggle/select/keypress)", () => {
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

  test("toggle/select/keypress 캡처 + checkbox click 이중기록 제거", async () => {
    await setReplayEnabled(panel, true);
    await enterDebug(panel);
    await expect(panel.getByTestId("replay-button")).toBeVisible();

    // fixture front → Replay tick이 프레임 버퍼. ready 먼저 확보(동작은 캡처 직전에).
    await fixture.bringToFront();
    await expect(async () => {
      await expect(panel.getByTestId("replay-button")).not.toHaveAttribute("aria-disabled", "true");
    }).toPass({ timeout: 45_000 });

    // ready 후 동작 수행(캡처 직전 — trim 윈도우 안). click(button/anchor)은 일부러 미수행 →
    // checkbox/radio/label-for 클릭이 click 엔트리로 새지 않음을 click 0건으로 단언한다.
    await fixture.locator("#action-check").click(); // toggle (checkbox 직접)
    await fixture.locator("#action-check-label").click(); // toggle (label[for] 연결 control)
    await fixture.locator("#action-radio").click(); // toggle (radio)
    await fixture.locator("#action-select").selectOption("kr"); // select (change)
    // 텍스트 입력: input 엔트리 발생 + 인쇄 문자 keydown은 keypress 미발생(focus는 click 아님 → click 0 유지)
    await fixture.locator("#action-input").focus();
    await fixture.locator("#action-input").pressSequentially("hi");
    // keypress: 특수키·조합만. Enter 2회는 dedup 없이 각각 기록.
    await fixture.keyboard.press("Escape");
    await fixture.keyboard.press("Control+k");
    await fixture.keyboard.press("Enter");
    await fixture.keyboard.press("Enter");

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

    // 새 3종 캡처 단언
    await expect(panel.locator('[data-kind="toggle"]')).toHaveCount(3); // checkbox + label-for + radio
    await expect(panel.locator('[data-kind="select"]')).toHaveCount(1);
    await expect(panel.locator('[data-kind="keypress"]')).toHaveCount(4); // Escape + Ctrl+K + Enter×2
    // checkbox/radio/label 클릭이 click으로 이중기록되지 않음(이 spec은 버튼·앵커를 안 누름)
    await expect(panel.locator('[data-kind="click"]')).toHaveCount(0);
    // 텍스트 타이핑은 input으로만(인쇄 문자 keypress 미발생 — keypress가 4 초과면 새는 것)
    await expect(panel.locator('[data-kind="input"]').first()).toBeVisible();

    // Enter 2회가 병합되지 않고 각각(키 조합 문자열은 i18n 무관 리터럴)
    await expect(panel.locator('[data-kind="keypress"]', { hasText: "Enter" })).toHaveCount(2);
    // 특수키·조합 표기 확인
    await expect(panel.locator('[data-kind="keypress"]', { hasText: "Escape" })).toHaveCount(1);
    await expect(panel.locator('[data-kind="keypress"]', { hasText: "Ctrl+K" })).toHaveCount(1);

    // 모달은 열린 채면 afterAll 탭 전환을 막는다 → Escape로 닫는다.
    await panel.keyboard.press("Escape");
    await expect(panel.locator('[data-kind="toggle"]')).toHaveCount(0);
  });
});
