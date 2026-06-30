import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 30s Replay 트리밍 오버레이 — 캡처 후 drafting 위로 자동 등장.
// ✗ 취소(캡처 폐기→EmptyState) / 구간 좁힘 후 ✓(trim 적용→drafting) 경로를 커버.
// 드래그는 flaky하므로 Slider thumb 포커스 + 키보드 ArrowLeft를 결정적 입력으로 쓴다(README 함정).
// replayEnabled는 chrome.storage 영속 → afterAll에서 해제(후행 spec 오염 방지).

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

test.describe.serial("30s Replay 트리밍 오버레이", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("actions.html"));
    const tabId = await ext.fixtureTabId("http://127.0.0.1/actions.html");
    panel = await ext.openPanel(tabId);
    await setReplayEnabled(panel, true);
  });

  test.afterAll(async () => {
    await setReplayEnabled(panel, false);
    await panel.close();
    await fixture.close();
  });

  // idle에서 캡처를 트리거해 트림 오버레이가 뜰 때까지 진행한다.
  async function captureToOverlay(): Promise<void> {
    await enterDebug(panel);
    await expect(panel.getByTestId("replay-button")).toBeVisible();
    // fixture front → 백그라운드 레코더가 action 1건 캡처(로그 버튼 enable) + Replay tick 프레임 버퍼.
    await fixture.bringToFront();
    await fixture.locator("#action-btn").click();
    await expect(async () => {
      await expect(panel.getByTestId("replay-button")).not.toHaveAttribute("aria-disabled", "true");
    }).toPass({ timeout: 45_000 });
    await panel.bringToFront();
    await panel.getByTestId("replay-button").click();
    await expect(panel.getByTestId("replay-trim-overlay")).toBeVisible({ timeout: 45_000 });
  }

  test("오버레이 등장 → 로그 미리보기 → ✗ 취소 시 진입 화면 복귀", async () => {
    await captureToOverlay();

    // 로그 미리보기 — action 로그 버튼(캡처된 동작 1건 이상이라 활성) → 다이얼로그 열림 → 닫기.
    const actionLogBtn = panel.getByTestId("replay-trim-log-action");
    await expect(actionLogBtn).toBeEnabled();
    await actionLogBtn.click();
    await expect(panel.getByTestId("action-log-preview-dialog")).toBeVisible();
    await panel.keyboard.press("Escape");
    await expect(panel.getByTestId("action-log-preview-dialog")).toHaveCount(0);

    // ✗ 취소 → 확인 AlertDialog → 확정 시 캡처 폐기 + idle(EmptyState) 복귀.
    await panel.getByTestId("replay-trim-cancel").click();
    await panel.getByTestId("replay-trim-cancel-confirm").click();
    await expect(panel.getByTestId("replay-trim-overlay")).toHaveCount(0);
    await expect(panel.getByTestId("drafting-panel")).toHaveCount(0);
    await expect(panel.getByTestId("replay-button")).toBeVisible();
  });

  test("구간 좁힘(키보드) → 선택 길이 감소 → ✓ 확정 시 drafting 진입", async () => {
    await captureToOverlay();

    // duration 로드(=confirm 활성) 대기 후 선택 길이 readout 확보.
    const confirm = panel.getByTestId("replay-trim-confirm");
    await expect(confirm).toBeEnabled();
    const overlay = panel.getByTestId("replay-trim-overlay");
    const initialSel = Number(await overlay.getAttribute("data-trim-selection"));
    expect(initialSel).toBeGreaterThan(0);

    // 끝 지점 thumb(2번째 Slider) 포커스 → ArrowLeft로 끝을 당겨 구간 좁힘(결정적 입력).
    const endThumb = panel.locator('[role="slider"]').nth(1);
    await endThumb.focus();
    for (let i = 0; i < 30; i++) await panel.keyboard.press("ArrowLeft");

    // data-trim-selection(=round(end-start))이 초기 전체 길이보다 줄었는지 판정.
    await expect
      .poll(async () => Number(await overlay.getAttribute("data-trim-selection")))
      .toBeLessThan(initialSel);

    // ✓ 확정 → 선택 구간 재인코딩 후 오버레이 닫힘 + drafting 미리보기(영상 다운로드 가능).
    await confirm.click();
    await expect(overlay).toHaveCount(0, { timeout: 45_000 });
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await expect(panel.getByTestId("download-media")).toBeVisible();
  });
});
