import { enterDebug, expect, test } from "./fixtures/extension";

// 초안 영속 — to-preview(confirmDraft)가 IssueRecord를 저장하고, 패널을 닫았다 다시 열어도
// 이슈 목록에서 초안을 열어(DraftDetailDialog) 내용이 복원되는지. 에디터 세션(session.spec의
// 폐기 검증)과 달리 issues-store는 chrome.storage.local이라 패널 생명주기를 넘어 보존돼야 한다.
test("초안 저장 → 패널 재열기 → 이슈 목록에서 초안 내용 복원", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();

  let panel = await ext.openPanel(tabId);
  await enterDebug(panel);
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  await panel.getByTestId("draft-title").fill("Resume e2e draft");
  await panel
    .getByTestId("draft-section-description")
    .locator('[contenteditable="true"]')
    .fill("resume body text");
  // preview 진입 = confirmDraft → issues-store에 초안 저장.
  await panel.getByTestId("to-preview").click();
  await expect(panel.getByTestId("preview-section-description")).toContainText(
    "resume body text",
  );

  await panel.close();

  panel = await ext.openPanel(tabId);
  // hydration 전 클릭 유실 — 클릭+active 폴링으로 흡수 (README gotcha).
  await expect(async () => {
    await panel.getByTestId("tab-issue-list").click();
    await expect(panel.getByTestId("tab-issue-list")).toHaveAttribute(
      "data-state",
      "active",
    );
  }).toPass();
  const row = panel
    .getByTestId("issue-row")
    .filter({ hasText: "Resume e2e draft" });
  await expect(row).toHaveCount(1);
  await expect(row).not.toHaveAttribute("data-status", "submitted");

  await row.click();
  const dialog = panel.getByTestId("draft-detail-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Resume e2e draft");
  await expect(dialog).toContainText("resume body text");

  await panel.close();
  await fixture.close();
});
