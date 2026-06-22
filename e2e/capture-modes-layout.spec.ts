import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// recording-mode-setting: idle 캡처 진입 화면 1×2×2 레이아웃 + 녹화 모드 설정.
// Row1 요소선택 / Row2 요소캡처·범위캡처 / Row3 segmented [녹화(우측 ⚙ 오버레이)·리플레이](2행과 동일 ButtonGroup).
// 녹화 모드(탭/화면)는 설정 캡처 섹션 Tabs에서 고르고, 그리드 녹화 버튼이 라이브 반영.
// 실제 getDisplayMedia/tabCapture 녹화는 자동화 불가(수동 잔여) — 여기선 버튼 노출·DOM 구조·라벨 전환만 판정.
//
// e2e는 `--lang=ko` 고정이라 라벨 단언은 ko 문자열 리터럴(issue.mode.video="탭 녹화" / issue.mode.screenRecord="화면 녹화").

test.describe.serial("capture-modes-layout: idle 1×2×2 + 녹화 모드", () => {
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
    // 설정 영속 오염 복원 — 기본 "tab"으로 되돌린다.
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
    // 구 분리 버튼은 단일 mode-record로 대체됨.
    await expect(panel.getByTestId("mode-video")).toHaveCount(0);
    await expect(panel.getByTestId("mode-screen-record")).toHaveCount(0);
  });

  test("Row3: 녹화·리플레이가 같은 segmented ButtonGroup, ⚙는 녹화칸 오버레이", async () => {
    // 2행 캡처모드와 동일한 ButtonGroup(segmented)에 녹화 버튼과 리플레이가 같이 든다.
    const recordGroup = panel.locator('[data-slot="button-group"]', {
      has: panel.getByTestId("mode-record"),
    });
    await expect(recordGroup.getByTestId("replay-button")).toHaveCount(1);
    await expect(recordGroup.getByTestId("mode-record-settings")).toHaveCount(1);
    // ⚙는 녹화 버튼의 부모(relative 래퍼)에 오버레이로 들어가고, 리플레이는 그 래퍼 밖.
    const recordWrapper = panel.getByTestId("mode-record").locator("xpath=..");
    await expect(recordWrapper.getByTestId("mode-record-settings")).toHaveCount(1);
    await expect(recordWrapper.getByTestId("replay-button")).toHaveCount(0);
  });

  test("기본 모드는 탭 녹화 — 녹화 버튼이 탭(AppWindow) 아이콘", async () => {
    // 라벨 텍스트는 locale 의존이라 회피 — recordModeMeta 기반 아이콘(lucide 클래스)으로 판정.
    const record = panel.getByTestId("mode-record");
    await expect(record.locator("svg.lucide-app-window")).toHaveCount(1);
    await expect(record.locator("svg.lucide-monitor-play")).toHaveCount(0);
  });

  test("⚙ 클릭 → 설정 탭(이슈 sub-tab) 열림, 녹화는 시작 안 됨", async () => {
    await panel.getByTestId("mode-record-settings").click();
    await expect(panel.getByTestId("tab-settings")).toHaveAttribute("data-state", "active");
    await expect(panel.getByTestId("settings-sub-issue")).toHaveAttribute("data-state", "active");
    // 녹화가 시작됐다면 설정이 아니라 recording 화면이었을 것 — 설정 진입 자체가 stopPropagation 증거.
    await expect(panel.getByTestId("recording-mode-tab")).toBeVisible();
  });

  test("설정에서 '화면 녹화'로 바꾸면 그리드 녹화 버튼 라벨이 라이브로 '화면 녹화'로 바뀐다", async () => {
    // 직전 test에서 이미 설정 issue sub-tab에 있음. 화면 녹화 선택.
    await panel.getByTestId("recording-mode-screen").click();
    await expect(panel.getByTestId("recording-mode-screen")).toHaveAttribute("data-state", "active");

    // 캡처 진입 화면으로 복귀 — 리로드 없이 라이브 반영. 아이콘이 화면(MonitorPlay)으로 전환.
    await enterDebug(panel);
    const record = panel.getByTestId("mode-record");
    await expect(record.locator("svg.lucide-monitor-play")).toHaveCount(1);
    await expect(record.locator("svg.lucide-app-window")).toHaveCount(0);
  });
});
