import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 30s Replay 트리밍 종합 — 로그 트림 + 타임스탬프 0 기준 보정.
// 시차를 둔 action 클릭으로 영상 타임라인 전반에 로그를 분포시킨 뒤 앞 구간을 트림하면:
//   ① 앞쪽 로그가 잘려 drafting 로그 수가 줄어든다(가드밴드가 경계 밖 로그를 도로 끌어오던
//      회귀 가드 — apply-trim.ts: 잘라낸 쪽은 정확한 프레임 wall-clock, 가드 미적용).
//   ② 살아남은 첫 로그의 상대시각이 새 영상 시작 기준(≈0:00)으로 보정되고,
//      같은 로그(마지막 항목)의 상대시각이 트림 전보다 작아진다(syncBaseMs=새 videoStartedAt).
// 드래그는 비결정적(README 함정)이라 시작 thumb 포커스 + ArrowRight로 결정적 입력.

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

// "0:03" → 3 (상대시각 초 파싱). 형식 불일치면 NaN.
function relSeconds(label: string | null): number {
  const m = (label ?? "").trim().match(/^(\d+):(\d+)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

test.describe.serial("30s Replay 트리밍 — 로그 트림 + 타임스탬프 보정", () => {
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

  test("앞 구간 트림 → 앞쪽 로그 잘림 + 살아남은 로그 타임스탬프 보정", async () => {
    await enterDebug(panel);
    await expect(panel.getByTestId("replay-button")).toBeVisible();

    // fixture front → 프레임 버퍼 + 시차 클릭으로 action 로그를 타임라인 전반에 분포(각 1.1s 간격).
    await fixture.bringToFront();
    const CLICKS = 6;
    for (let i = 0; i < CLICKS; i++) {
      await fixture.locator("#action-btn").click();
      await fixture.waitForTimeout(1100);
    }

    // Replay ready(≥10 프레임) 대기 — fixture가 front인 채라 프레임 계속 적재(panel DOM은
    // 백그라운드여도 읽힌다). 여기서는 새 클릭 없음 → action은 앞쪽 ~6.6s 구간에만 분포.
    await expect(async () => {
      await expect(panel.getByTestId("replay-button")).not.toHaveAttribute("aria-disabled", "true");
    }).toPass({ timeout: 45_000 });

    // 패널 front → 캡처 → 트림 오버레이.
    await panel.bringToFront();
    await panel.getByTestId("replay-button").click();
    const overlay = panel.getByTestId("replay-trim-overlay");
    await expect(overlay).toBeVisible({ timeout: 45_000 });
    await expect(panel.getByTestId("replay-trim-confirm")).toBeEnabled();

    // 트림 전(전체 구간) action 로그 미리보기 — 개수 N, 마지막 행 상대시각 R_pre 확보.
    await panel.getByTestId("replay-trim-log-action").click();
    const overlayDialog = panel.getByTestId("action-log-preview-dialog");
    await expect(overlayDialog).toBeVisible();
    const N = await overlayDialog.locator("[data-entry-id]").count();
    expect(N).toBeGreaterThanOrEqual(4); // 6 클릭 — 환경 변동 흡수해 하한만
    const rPre = relSeconds(
      await overlayDialog.getByTestId("log-rel-time").last().textContent(),
    );
    expect(rPre).toBeGreaterThan(0); // 마지막 클릭은 영상 뒤쪽 → 0:00 아님
    await panel.keyboard.press("Escape");
    await expect(overlayDialog).toHaveCount(0);

    // 앞 구간 트림 — 시작 thumb(slider nth0) 포커스 + ArrowRight×30(step 0.1 → +3s).
    const initialSel = Number(await overlay.getAttribute("data-trim-selection"));
    expect(initialSel).toBeGreaterThan(3);
    const startThumb = panel.locator('[role="slider"]').nth(0);
    await startThumb.focus();
    for (let i = 0; i < 30; i++) await panel.keyboard.press("ArrowRight");
    await expect
      .poll(async () => Number(await overlay.getAttribute("data-trim-selection")))
      .toBeLessThan(initialSel);

    // ✓ 확정 → 재인코딩 → drafting.
    await panel.getByTestId("replay-trim-confirm").click();
    await expect(overlay).toHaveCount(0, { timeout: 45_000 });
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();

    // drafting action 로그 카드 → 다이얼로그. 개수 M.
    await panel.getByTestId("action-log-card").click();
    const draftDialog = panel.getByTestId("action-log-preview-dialog");
    await expect(draftDialog).toBeVisible();
    const M = await draftDialog.locator("[data-entry-id]").count();

    // ① 앞쪽 로그가 잘렸다 — M < N (가드밴드 회귀 가드) + 최소 1건 생존.
    expect(M).toBeGreaterThanOrEqual(1);
    expect(M).toBeLessThan(N);

    // ② 타임스탬프 보정 — 첫 생존 로그는 새 시작 기준 ≈0:00, 마지막 로그는 트림 전보다 작아짐.
    const firstRel = relSeconds(
      await draftDialog.getByTestId("log-rel-time").first().textContent(),
    );
    expect(firstRel).toBeLessThanOrEqual(1); // 새 videoStartedAt 기준 보정
    const rPost = relSeconds(
      await draftDialog.getByTestId("log-rel-time").last().textContent(),
    );
    expect(rPost).toBeLessThan(rPre); // 같은 마지막 로그가 base shift만큼 당겨짐

    await panel.keyboard.press("Escape");
    await expect(draftDialog).toHaveCount(0);
  });
});
