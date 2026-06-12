import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 이슈 섹션 설정 — 토글이 drafting 섹션 노출과 preview 본문 구성에 반영되는지.
// 기본값: description·stepsToReproduce·expectedResult ON, notes OFF.
// 설정은 chrome.storage에 영속되므로 후행 spec 오염 방지를 위해 finally에서 기본값 복원.

async function setSectionEnabled(panel: Page, sectionId: string, enabled: boolean) {
  // fresh 프로필은 integrations 자동 전환 effect와 race — enterDebug와 같은 active 폴링으로 흡수.
  await expect(async () => {
    await panel.getByTestId("tab-settings").click();
    await expect(panel.getByTestId("tab-settings")).toHaveAttribute(
      "data-state",
      "active",
    );
  }).toPass();
  await panel.getByTestId("settings-sub-issue").click();
  const sw = panel.locator(`[id="issue-section-${sectionId}"]`);
  await expect(sw).toBeVisible();
  if (((await sw.getAttribute("data-state")) === "checked") !== enabled) {
    await sw.click();
  }
  await expect(sw).toHaveAttribute(
    "data-state",
    enabled ? "checked" : "unchecked",
  );
}

test("섹션 토글(notes ON·expectedResult OFF) → drafting·preview 본문 반영", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  try {
    await setSectionEnabled(panel, "notes", true);
    await setSectionEnabled(panel, "expectedResult", false);

    await enterDebug(panel);
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();

    await expect(panel.getByTestId("draft-section-description")).toBeVisible();
    await expect(panel.getByTestId("draft-section-notes")).toBeVisible();
    await expect(panel.getByTestId("draft-section-expectedResult")).toHaveCount(0);

    await panel.getByTestId("draft-title").fill("Sections e2e bug");
    await panel
      .getByTestId("draft-section-notes")
      .locator('[contenteditable="true"]')
      .fill("notes section body");
    // to-preview는 aria-disabled 클릭 가드 — 활성화 확인 후 클릭 (조용한 no-op 방지).
    await expect(panel.getByTestId("to-preview")).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await panel.getByTestId("to-preview").click();

    await expect(panel.getByTestId("preview-section-notes")).toContainText(
      "notes section body",
    );
    await expect(panel.getByTestId("preview-section-expectedResult")).toHaveCount(0);
  } finally {
    await setSectionEnabled(panel, "notes", false);
    await setSectionEnabled(panel, "expectedResult", true);
    await panel.close();
    await fixture.close();
  }
});
