import type { Page } from "@playwright/test";
import { expect } from "./extension";

// 설정 탭 진입·화면 언어 결정화 헬퍼 — issue-body-locale.spec에서 승격.
// 새 spec이 각자 복제하면 클립보드 스텁 3중 복제 함정(GOTCHAS)과 같은 형태가 된다.

export async function openSettings(panel: Page, sub: "issue" | "general") {
  // hydration 전 클릭 유실 — enterDebug와 같은 active 폴링으로 흡수.
  await expect(async () => {
    await panel.getByTestId("tab-settings").click();
    await expect(panel.getByTestId("tab-settings")).toHaveAttribute("data-state", "active");
  }).toPass();
  await panel.getByTestId(`settings-sub-${sub}`).click();
}

export async function setScreenLocale(panel: Page, label: string) {
  await openSettings(panel, "general");
  const trigger = panel.getByTestId("settings-locale");
  await expect(trigger).toBeVisible();
  if ((await trigger.innerText()).trim() === label) return;
  await trigger.click();
  await panel.getByRole("option", { name: label, exact: true }).click();
  await expect(trigger).toHaveText(label);
}
