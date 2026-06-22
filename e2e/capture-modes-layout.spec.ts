import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// recording-mode-setting: idle 캡처 진입 화면 레이아웃 + 녹화 모드 다이얼로그.
// Row1 [요소 편집][요소 캡처] / Row2 [범위 캡처] / Row3 segmented [녹화][30초 리플레이][⚙ 설정].
// ⚙는 설정 탭으로 이동하지 않고 "녹화 설정" 다이얼로그(녹화 모드 Tabs + 30초 리플레이)를 띄운다.
// 녹화 모드(탭/화면)를 바꾸면 그리드 녹화 버튼 아이콘이 라이브 반영.
// 실제 getDisplayMedia/tabCapture 녹화는 자동화 불가(수동 잔여) — 여기선 버튼 노출·DOM 구조·아이콘 전환만 판정.
//
// 주의: 설정 탭의 RecordingSettingsCard도 항상 마운트(hidden)돼 recording-mode-* testid가 다이얼로그와
// 중복되므로, 다이얼로그 내부 상호작용은 getByRole("dialog")로 스코프한다.

test.describe.serial("capture-modes-layout: idle 레이아웃 + 녹화 설정 다이얼로그", () => {
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
    // 설정 영속 오염 복원 — 기본 "tab"으로 되돌린다(설정 탭 카드 경유, 다이얼로그 닫힌 상태라 testid 단일).
    await panel.getByTestId("tab-settings").click();
    await panel.getByTestId("settings-sub-issue").click();
    await panel.getByTestId("recording-mode-tab").click();
    await panel.close();
    await fixture.close();
  });

  test("idle에 캡처 진입 버튼이 모두 노출된다 (mode-video/screen-record 분리 버튼은 사라짐)", async () => {
    for (const id of [
      "mode-element",
      "mode-element-shot",
      "mode-screenshot",
      "mode-record",
      "mode-record-settings",
      "replay-button",
    ]) {
      await expect(panel.getByTestId(id)).toBeVisible();
    }
    await expect(panel.getByTestId("mode-video")).toHaveCount(0);
    await expect(panel.getByTestId("mode-screen-record")).toHaveCount(0);
  });

  test("Row1: [요소 편집][요소 캡처] 같은 ButtonGroup, 범위 캡처는 단독", async () => {
    const elementGroup = panel.locator('[data-slot="button-group"]', {
      has: panel.getByTestId("mode-element"),
    });
    await expect(elementGroup.getByTestId("mode-element-shot")).toHaveCount(1);
    await expect(elementGroup.getByTestId("mode-screenshot")).toHaveCount(0);
  });

  test("Row3: [녹화][리플레이][⚙] 3-segment ButtonGroup, 녹화·리플레이 균등 너비 + ⚙ 정방형", async () => {
    const recordGroup = panel.locator('[data-slot="button-group"]', {
      has: panel.getByTestId("mode-record"),
    });
    await expect(recordGroup.getByTestId("replay-button")).toHaveCount(1);
    await expect(recordGroup.getByTestId("mode-record-settings")).toHaveCount(1);

    // 녹화 버튼과 리플레이는 너비를 균등 공유한다(둘 다 flex-1). ±2px 이내.
    const recBox = await panel.getByTestId("mode-record").boundingBox();
    const repBox = await panel.getByTestId("replay-button").boundingBox();
    expect(recBox).not.toBeNull();
    expect(repBox).not.toBeNull();
    expect(Math.abs(recBox!.width - repBox!.width)).toBeLessThanOrEqual(2);

    // ⚙ 설정 버튼은 정방형(size=icon).
    const gearBox = await panel.getByTestId("mode-record-settings").boundingBox();
    expect(gearBox).not.toBeNull();
    expect(Math.abs(gearBox!.width - gearBox!.height)).toBeLessThanOrEqual(2);
  });

  test("기본 모드는 탭 — 녹화 버튼이 탭(AppWindow) 아이콘", async () => {
    // 라벨 텍스트는 locale 의존이라 회피 — recordModeMeta 기반 아이콘(lucide 클래스)으로 판정.
    const record = panel.getByTestId("mode-record");
    await expect(record.locator("svg.lucide-app-window")).toHaveCount(1);
    await expect(record.locator("svg.lucide-monitor-play")).toHaveCount(0);
  });

  test("비활성 30초 리플레이 클릭 → 녹화 설정 다이얼로그 열림 (설정 탭 이동 아님)", async () => {
    // e2e는 replayEnabled 기본 false라 리플레이 버튼이 비활성 상태(aria-disabled="true").
    // Playwright actionability가 aria-disabled를 막으므로 force로 클릭(onClick은 가드 없이 다이얼로그를 연다).
    await panel.getByTestId("replay-button").click({ force: true });
    const dialog = panel.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("recording-mode-tab")).toBeVisible();
    await expect(panel.getByTestId("tab-debug")).toHaveAttribute("data-state", "active");
    await panel.keyboard.press("Escape");
    await expect(panel.getByRole("dialog")).toHaveCount(0);
  });

  test("⚙ 클릭 → 녹화 설정 다이얼로그 열림 (설정 탭 이동 아님)", async () => {
    await panel.getByTestId("mode-record-settings").click();
    const dialog = panel.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("recording-mode-tab")).toBeVisible();
    // 설정 메인 탭으로 이동하지 않고 디버그 화면 유지 — 다이얼로그만 오버레이.
    await expect(panel.getByTestId("tab-debug")).toHaveAttribute("data-state", "active");
  });

  test("다이얼로그에서 '화면' 선택 → 닫으면 녹화 버튼 아이콘이 라이브로 화면(MonitorPlay)으로 전환", async () => {
    // 직전 test에서 연 다이얼로그가 그대로 열려 있다.
    const dialog = panel.getByRole("dialog");
    await dialog.getByTestId("recording-mode-screen").click();
    await expect(dialog.getByTestId("recording-mode-screen")).toHaveAttribute("data-state", "active");

    await panel.keyboard.press("Escape");
    await expect(panel.getByRole("dialog")).toHaveCount(0);

    const record = panel.getByTestId("mode-record");
    await expect(record.locator("svg.lucide-monitor-play")).toHaveCount(1);
    await expect(record.locator("svg.lucide-app-window")).toHaveCount(0);
  });
});
