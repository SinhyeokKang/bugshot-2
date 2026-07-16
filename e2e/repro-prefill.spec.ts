import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 재현 단계 자동 채움 — 스크립트 판정 가능한 주변부만 커버한다.
// 핵심(video drafting 진입 시 액션 로그로 stepsToReproduce AI 자동 채움 + 패널 전체
// AI 오버레이)은 captureMode="video" 게이트 + 실 녹화(tabCapture/getDisplayMedia) 의존이라
// 자동화 불가 → 수동 잔여(COVERAGE.md "수동 캡처 video 모드"와 동일 사유).
// 여기서는 ① opt-out 토글(기본 ON·영속)과 ② 전체 초기화 버튼만 검증한다.

const SW = '[id="setting-auto-repro-prefill"]';

async function gotoSettings(panel: Page) {
  // hydration 전 클릭 유실을 active 폴링으로 흡수(attachments/settings-sections 패턴).
  await expect(async () => {
    await panel.getByTestId("tab-settings").click();
    await expect(panel.getByTestId("tab-settings")).toHaveAttribute(
      "data-state",
      "active",
    );
  }).toPass();
  await panel.getByTestId("settings-sub-issue").click();
}

test.describe.serial("재현 단계 자동 채움", () => {
  let fixture: Page;
  let panel: Page;
  let tabId: number;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    // 기본값(ON)으로 복원 — 설정은 chrome.storage 영속이라 후행 spec 오염 방지.
    await gotoSettings(panel);
    const sw = panel.locator(SW);
    await expect(sw).toBeVisible();
    if ((await sw.getAttribute("data-state")) !== "checked") await sw.click();
    await expect(sw).toHaveAttribute("data-state", "checked");
    await panel.close();
    await fixture.close();
  });

  test("재현 단계 섹션 전체 초기화 버튼 — 값 있을 때만 활성, 클릭 시 비움", async () => {
    await enterDebug(panel);
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();

    const reset = panel.getByTestId("draft-section-stepsToReproduce-reset");
    const firstRow = panel
      .getByTestId("draft-section-stepsToReproduce")
      .locator("input")
      .first();

    // 빈 값 → 버튼 비활성.
    await expect(reset).toBeDisabled();

    // 값 입력 → 활성.
    await firstRow.fill("repro step one");
    await expect(reset).toBeEnabled();

    // 클릭 → 전체 비움 + 다시 비활성.
    await reset.click();
    await expect(firstRow).toHaveValue("");
    await expect(reset).toBeDisabled();
  });

  test("AI 설정 — 재현 과정 채우기 토글 기본 ON, opt-out 영속", async ({
    ext,
  }) => {
    await gotoSettings(panel);
    const sw = panel.locator(SW);
    await expect(sw).toBeVisible();
    // 기본 ON.
    await expect(sw).toHaveAttribute("data-state", "checked");

    // opt-out → unchecked.
    await sw.click();
    await expect(sw).toHaveAttribute("data-state", "unchecked");

    // 패널 재열기 → 영속(chrome.storage.local rehydrate)돼 여전히 unchecked.
    await panel.close();
    panel = await ext.openPanel(tabId);
    await gotoSettings(panel);
    const sw2 = panel.locator(SW);
    await expect(sw2).toBeVisible();
    await expect(sw2).toHaveAttribute("data-state", "unchecked");
  });

  test("본문 설정에서 재현 과정 섹션을 끄면 채우기 토글은 ON/OFF 상태를 유지한 채 비활성", async () => {
    await gotoSettings(panel);
    const sw = panel.locator(SW);
    const section = panel.locator('[id="issue-section-stepsToReproduce"]');
    await expect(sw).toBeVisible();

    // 직전 테스트가 opt-out(unchecked)으로 둔 상태에서 시작 — 이 값이 보존되는지가 요점.
    await expect(sw).toHaveAttribute("data-state", "unchecked");
    await expect(sw).toBeEnabled();

    // 재현 과정 섹션 off → 토글 비활성, 상태는 그대로.
    await section.click();
    await expect(section).toHaveAttribute("data-state", "unchecked");
    await expect(sw).toBeDisabled();
    await expect(sw).toHaveAttribute("data-state", "unchecked");

    // 섹션을 다시 켜면 토글도 되살아나고 상태는 여전히 그대로.
    await section.click();
    await expect(section).toHaveAttribute("data-state", "checked");
    await expect(sw).toBeEnabled();
    await expect(sw).toHaveAttribute("data-state", "unchecked");
  });
});
