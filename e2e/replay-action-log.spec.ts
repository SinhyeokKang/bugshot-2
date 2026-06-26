import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 30s Replay 캡처 → drafting(video) → action 로그 카드/다이얼로그.
// 수동 video(getUserMedia/tabCapture)와 달리 Replay는 captureVisibleTab 폴링이라(e2e <all_urls>)
// 자동화 가능. action 로그는 idle 중 백그라운드 레코더가 상시 캡처하고, capture()가 trim해 첨부한다.
// replayEnabled는 chrome.storage 영속 → afterAll에서 해제 복원(후행 spec 오염 방지).

// 설정 issue 서브탭의 replay 스위치 토글. e2e 빌드는 host_permissions <all_urls>라
// permissions.contains(BROAD_HOST_ORIGINS)가 true → 프롬프트 없이 setReplayEnabled.
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

test.describe.serial("30s Replay + action 로그", () => {
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

  test("Replay 캡처가 action 로그를 drafting 카드/다이얼로그로 노출", async () => {
    // 1) Replay 활성화
    await setReplayEnabled(panel, true);

    // 2) 디버그 진입 — Replay 버튼이 캡처 진입 화면에 렌더
    await enterDebug(panel);
    await expect(panel.getByTestId("replay-button")).toBeVisible();

    // 3) fixture를 front로 → 백그라운드 레코더가 action 캡처 + Replay tick이 프레임 버퍼.
    //    bringToFront 직후 동작을 기록(가드밴드 1500ms·30s cap 내라 trim 윈도우에 포함).
    await fixture.bringToFront();
    await fixture.locator("#action-btn").click();
    await fixture.locator("#action-noname").click(); // 이름 없는 버튼 → tag 모드
    await fixture.locator("#action-input").fill("layout broken");
    await fixture.locator("#action-nav").click();

    // 4) Replay 버퍼 ready 대기(≥10 프레임, 600ms 간격). 패널이 백그라운드면 타이머가 throttle돼
    //    프레임이 ~1/s로 쌓이므로 넉넉히. ready=버튼 aria-disabled 해제.
    await expect(async () => {
      await expect(panel.getByTestId("replay-button")).not.toHaveAttribute("aria-disabled", "true");
    }).toPass({ timeout: 45_000 });

    // 5) 패널 front → 캡처 트리거(encodeToMp4 후 drafting 전환)
    await panel.bringToFront();
    await expect(panel.getByTestId("replay-button")).not.toHaveAttribute("aria-disabled", "true");
    await panel.getByTestId("replay-button").click();

    // 6) drafting 진입(mp4 인코딩 시간 고려)
    await expect(panel.getByTestId("drafting-panel")).toBeVisible({ timeout: 45_000 });

    // 6.5) 미디어(영상) 섹션 다운로드 → recording.mp4 (encodeToMp4 blob=video/mp4).
    //      action 카드 다이얼로그 열기 전에 단언(모달 오버레이가 클릭 막는 것 회피).
    const [videoDownload] = await Promise.all([
      panel.waitForEvent("download"),
      panel.getByTestId("download-media").click(),
    ]);
    expect(videoDownload.suggestedFilename()).toBe("recording.mp4");

    // 7) action 로그 카드 노출 → 클릭해 다이얼로그
    const card = panel.getByTestId("action-log-card");
    await expect(card).toBeVisible();
    await card.click();

    // 8) 다이얼로그 내 kind별 행 단언(click·input·navigation 모두 캡처)
    await expect(panel.locator('[data-kind="click"]').first()).toBeVisible();
    await expect(panel.locator('[data-kind="input"]').first()).toBeVisible();
    await expect(panel.locator('[data-kind="navigation"]').first()).toBeVisible();

    // 9) 인라인 스타일링 — 입력값 칩 / 이름 없는 클릭 태그 / 이동 URL 링크
    await expect(panel.getByTestId("action-value-chip").first()).toBeVisible();
    await expect(panel.getByTestId("action-tag").first()).toBeVisible();
    await expect(panel.getByTestId("action-nav-link").first()).toBeVisible();

    // 모달을 닫는다 — 열린 채면 afterAll의 탭 전환 클릭이 오버레이에 막혀 행(hang).
    await panel.keyboard.press("Escape");
    await expect(panel.locator('[data-kind="click"]')).toHaveCount(0);
  });
});
