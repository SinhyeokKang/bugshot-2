import { enterDebug, expect, test } from "./fixtures/extension";
import { stubClipboard } from "./fixtures/clipboard";

// 이미지 삽입 하니스는 ai-draft·inline-image-annotation과 동일(section-image-input + 유효 1x1 PNG).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

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

  // 인라인 이미지 — 복사본에 data: URI가 실리면 Notion·Slack·Jira가 붙여넣기를 **통째로**
  // 거부해 제목·재현 단계·로그 요약까지 유실된다(실측, 크기 무관). 클라이언트 온리라 호스팅
  // URL을 만들 수 없어 복사 경로는 이미지를 포기하고 본문을 살린다.
  await panel.getByTestId("section-image-input-description").setInputFiles({
    name: "shot.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });
  await expect(
    panel.getByTestId("draft-section-description").locator("img"),
  ).toBeVisible();

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

  await stubClipboard(panel);
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

  // rich flavor 보존 — Jira·Notion·Asana 붙여넣기의 표·이미지가 여기 달려 있다.
  const copiedHtml = await panel.evaluate(
    () => (window as unknown as { __copiedHtml: string[] }).__copiedHtml.join("\n"),
  );
  expect(copiedHtml).toContain("freeform description body");
  expect(copiedHtml).toMatch(/<\/(p|h1|h2|h3|li|td)>/);

  // 이 버그의 유일한 e2e 그물이다 — 편집 화면엔 이미지가 보이는데(위 img 단언) 복사본엔
  // data: URI가 없어야 한다. 두 flavor 모두 본다: plain에 213KB짜리 base64가 실리면
  // GitHub 마크다운 입력에서도 읽을 수 없는 덩어리가 된다.
  expect(copiedHtml).not.toContain("data:image");
  expect(copiedHtml).not.toMatch(/<img[^>]+src="data:/);
  expect(copied).not.toContain("data:image");

  await panel.close();
  await fixture.close();
});
