import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// revert-idle-capture-layout: idle 캡처 진입 화면을 1x2x2로 원복.
// Row1 [요소 스타일 편집](primary 단독) / Row2 [요소 캡처][범위 캡처] / Row3 [녹화][30초 리플레이].
// ⚙ 녹화 설정 버튼·녹화 설정 다이얼로그 제거. 비활성 리플레이 클릭 → 설정 탭 이동(다이얼로그 아님).
// 설정된 녹화 모드(탭/화면)에 따른 녹화 버튼 아이콘 분기는 유지(recordModeMeta).
// 라벨 텍스트는 locale 비결정이라 단언 금지 — lucide 아이콘 클래스로 모드 판정(README 함정 참조).
// 실제 getDisplayMedia/tabCapture 녹화는 자동화 불가(수동 잔여) — 버튼 노출·DOM 구조·아이콘 전환만 판정.

test.describe.serial("capture-modes-layout: 1x2x2 idle 레이아웃 + 녹화 모드 분기", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
  });

  test.afterAll(async () => {
    // 설정 영속 오염 복원 — 기본 "tab"으로 되돌린다(설정 탭 카드 경유).
    await panel.getByTestId("tab-settings").click();
    await panel.getByTestId("settings-sub-issue").click();
    await panel.getByTestId("recording-mode-tab").click();
    await panel.close();
    await fixture.close();
  });

  test("idle에 1x2x2 캡처 버튼 노출 (⚙·구 분리 녹화 버튼 부재)", async () => {
    for (const id of [
      "mode-element",
      "mode-element-shot",
      "mode-screenshot",
      "mode-record",
      "replay-button",
      "mode-freeform",
    ]) {
      await expect(panel.getByTestId(id)).toBeVisible();
    }
    await expect(panel.getByTestId("mode-record-settings")).toHaveCount(0);
    await expect(panel.getByTestId("mode-video")).toHaveCount(0);
    await expect(panel.getByTestId("mode-screen-record")).toHaveCount(0);
  });

  test("Row1: 요소 스타일 편집은 primary 단독 (ButtonGroup 밖)", async () => {
    const elementGroup = panel.locator('[data-slot="button-group"]', {
      has: panel.getByTestId("mode-element"),
    });
    await expect(elementGroup).toHaveCount(0);
  });

  test("Row2: [요소 캡처][범위 캡처] 같은 ButtonGroup, 요소 편집은 미포함", async () => {
    const row2 = panel.locator('[data-slot="button-group"]', {
      has: panel.getByTestId("mode-element-shot"),
    });
    await expect(row2.getByTestId("mode-screenshot")).toHaveCount(1);
    await expect(row2.getByTestId("mode-element")).toHaveCount(0);
  });

  test("Row3: [녹화][리플레이] 2-segment ButtonGroup, 균등 너비 + ⚙ 부재", async () => {
    const row3 = panel.locator('[data-slot="button-group"]', {
      has: panel.getByTestId("mode-record"),
    });
    await expect(row3.getByTestId("replay-button")).toHaveCount(1);
    await expect(row3.getByTestId("mode-record-settings")).toHaveCount(0);

    // 녹화 버튼과 리플레이는 너비를 균등 공유한다(둘 다 flex-1). ±2px 이내.
    const recBox = await panel.getByTestId("mode-record").boundingBox();
    const repBox = await panel.getByTestId("replay-button").boundingBox();
    expect(recBox).not.toBeNull();
    expect(repBox).not.toBeNull();
    expect(Math.abs(recBox!.width - repBox!.width)).toBeLessThanOrEqual(2);
  });

  test("기본 모드는 탭 — 녹화 버튼이 탭(AppWindow) 아이콘", async () => {
    const record = panel.getByTestId("mode-record");
    await expect(record.locator("svg.lucide-app-window")).toHaveCount(1);
    await expect(record.locator("svg.lucide-monitor-play")).toHaveCount(0);
  });

  test("비활성 30초 리플레이 클릭 → 설정 탭 이동 (다이얼로그 아님)", async () => {
    // e2e는 replayEnabled 기본 false라 리플레이 버튼이 비활성(aria-disabled="true").
    // Playwright actionability가 aria-disabled를 막으므로 force로 클릭(onClick은 가드 없이 설정 탭으로 navTo).
    await panel.getByTestId("replay-button").click({ force: true });
    await expect(panel.getByTestId("tab-settings")).toHaveAttribute("data-state", "active");
    await expect(panel.getByTestId("settings-sub-issue")).toHaveAttribute("data-state", "active");
    await expect(panel.getByRole("dialog")).toHaveCount(0);
  });

  test("설정에서 '화면' 선택 → idle 복귀 시 녹화 버튼 아이콘이 화면(MonitorPlay)으로 전환", async () => {
    // 직전 test에서 설정>이슈 sub-tab에 와 있다.
    await panel.getByTestId("recording-mode-screen").click();
    await expect(panel.getByTestId("recording-mode-screen")).toHaveAttribute("data-state", "active");

    await enterDebug(panel);
    const record = panel.getByTestId("mode-record");
    await expect(record.locator("svg.lucide-monitor-play")).toHaveCount(1);
    await expect(record.locator("svg.lucide-app-window")).toHaveCount(0);
  });
});
