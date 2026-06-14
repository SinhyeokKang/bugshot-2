import { enterDebug, expect, test } from "./fixtures/extension";

// freeform 초안 — 캡처 없이 drafting 진입 → 제목·섹션 입력 → preview 렌더 → 마크다운 복사.
// 클립보드는 패널 컨텍스트에서 navigator.clipboard를 stub해 페이로드를 단언한다
// (확장 페이지 권한 프롬프트·OS 클립보드 의존 회피).
test("freeform 초안 → preview 렌더 → 마크다운 복사 페이로드", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();

  await panel.getByTestId("draft-title").fill("Freeform e2e bug");
  // 발생 현상(paragraph) — Tiptap contenteditable.
  await panel
    .getByTestId("draft-section-description")
    .locator('[contenteditable="true"]')
    .fill("freeform description body");
  // 재현 과정(orderedList) — 행 Input.
  await panel
    .getByTestId("draft-section-stepsToReproduce")
    .locator("input")
    .first()
    .fill("freeform step one");

  await panel.getByTestId("to-preview").click();
  await expect(panel.getByTestId("preview-section-description")).toContainText(
    "freeform description body",
  );
  await expect(
    panel.getByTestId("preview-section-stepsToReproduce"),
  ).toContainText("freeform step one");
  await expect(
    panel.getByRole("heading", { name: "Freeform e2e bug" }),
  ).toBeVisible();

  await panel.evaluate(() => {
    const w = window as unknown as { __copiedTexts: string[] };
    w.__copiedTexts = [];
    navigator.clipboard.write = async (items) => {
      for (const it of items) {
        const blob = await it.getType("text/plain");
        w.__copiedTexts.push(await blob.text());
      }
    };
    navigator.clipboard.writeText = async (t) => {
      w.__copiedTexts.push(t);
    };
  });
  await panel.getByTestId("copy-markdown").click();
  await expect
    .poll(() =>
      panel.evaluate(
        () => (window as unknown as { __copiedTexts: string[] }).__copiedTexts.join("\n"),
      ),
    )
    .toContain("freeform description body");
  const copied = await panel.evaluate(
    () => (window as unknown as { __copiedTexts: string[] }).__copiedTexts.join("\n"),
  );
  expect(copied).toContain("freeform step one");

  await panel.close();
  await fixture.close();
});
