import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 저장된 draft의 제목·본문 섹션을 이슈 목록 상세(DraftDetailDialog)에서 필드별 [수정]으로
// 편집(DraftEditDialog) → applyDraftFieldEdit로 patchIssue 반영. draft-resume가 검증한
// "초안 저장 → 이슈 목록 → 상세" 진입을 재사용하고, 그 상세 위에서 편집을 검증한다.
// Slack 보존 이슈(submitted+slackPreserved)도 상세에서 편집 가능한 케이스는 slack-issue-promotion.spec 커버
// (canEditDraftFields = draft || isSlackPreserved — 승격 전 문구 다듬기).
test.describe.serial("draft field edit", () => {
  // TITLE↔RENAMED는 서로 substring이 아니어야 issue-row hasText 필터 count 단언이 정확.
  const TITLE = "Alpha draft fieldedit";
  const RENAMED = "Bravo renamed heading";
  const DESC = "original description paragraph";
  const EDITED_DESC = "rewritten description paragraph";
  const DISCARDED = "discarded body should not persist";

  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await panel.getByTestId("draft-title").fill(TITLE);
    await panel
      .getByTestId("draft-section-description")
      .locator('[contenteditable="true"]')
      .fill(DESC);
    // preview 진입 = confirmDraft → issues-store에 초안(status:"draft") 저장.
    await panel.getByTestId("to-preview").click();
    await expect(panel.getByTestId("preview-section-description")).toContainText(
      DESC,
    );
    // 이슈 목록 탭 진입(hydration 전 클릭 유실은 클릭+active 폴링으로 흡수).
    await expect(async () => {
      await panel.getByTestId("tab-issue-list").click();
      await expect(panel.getByTestId("tab-issue-list")).toHaveAttribute(
        "data-state",
        "active",
      );
    }).toPass();
    const row = panel.getByTestId("issue-row").filter({ hasText: TITLE });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(panel.getByTestId("draft-detail-dialog")).toBeVisible();
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  test("섹션 [수정] → 편집 다이얼로그에서 저장 → 상세에 새 텍스트 반영", async () => {
    const detail = panel.getByTestId("draft-detail-dialog");
    await expect(detail).toContainText(DESC);

    await detail.getByTestId("edit-field-description").click();
    const editDialog = panel.getByTestId("draft-edit-dialog");
    await expect(editDialog).toBeVisible();

    const editor = editDialog.locator('[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.fill(EDITED_DESC);
    await panel.getByTestId("draft-edit-save").click();

    await expect(editDialog).toHaveCount(0);
    await expect(detail).toContainText(EDITED_DESC);
    await expect(detail).not.toContainText(DESC);
  });

  test("섹션 편집 후 [취소] → 상세 원본 유지(미저장)", async () => {
    const detail = panel.getByTestId("draft-detail-dialog");

    await detail.getByTestId("edit-field-description").click();
    const editDialog = panel.getByTestId("draft-edit-dialog");
    await expect(editDialog).toBeVisible();

    const editor = editDialog.locator('[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.fill(DISCARDED);
    await panel.getByTestId("draft-edit-cancel").click();

    await expect(editDialog).toHaveCount(0);
    await expect(detail).toContainText(EDITED_DESC);
    await expect(detail).not.toContainText(DISCARDED);
  });

  test("제목 [수정] → 저장 → 상세 제목 + 리스트 행 제목 갱신", async () => {
    const detail = panel.getByTestId("draft-detail-dialog");

    await detail.getByTestId("edit-title").click();
    const editDialog = panel.getByTestId("draft-edit-dialog");
    await expect(editDialog).toBeVisible();

    const titleInput = editDialog.locator("input");
    await expect(titleInput).toBeVisible();
    await titleInput.fill(RENAMED);
    await panel.getByTestId("draft-edit-save").click();

    await expect(editDialog).toHaveCount(0);
    await expect(detail).toContainText(RENAMED);
    // 리스트 행(상세 뒤 DOM에 존재)도 최상위 title 동시 갱신으로 새 제목 반영.
    await expect(
      panel.getByTestId("issue-row").filter({ hasText: RENAMED }),
    ).toHaveCount(1);
    await expect(
      panel.getByTestId("issue-row").filter({ hasText: TITLE }),
    ).toHaveCount(0);
  });
});
