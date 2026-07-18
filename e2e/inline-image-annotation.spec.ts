import { enterDebug, expect, test } from "./fixtures/extension";
import type { Page } from "@playwright/test";

// 본문(Tiptap) 삽입 인라인 이미지의 어노테이션 NodeView — hover 액션 그룹([초기화][주석][삭제]),
// 주석 오버레이 진입, 삭제. 캔버스 그리기(Konva 드래그)는 수동 잔여이므로 오버레이 *진입/취소*까지만.
// 이미지 삽입 하니스는 ai-draft.spec와 동일(section-image-input + 유효 1x1 PNG).

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

const descEditor = (panel: Page) =>
  panel.getByTestId("draft-section-description").locator('[contenteditable="true"]');

test.describe.serial("본문 인라인 이미지 어노테이션", () => {
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

    // 발생 현상 섹션에 텍스트를 먼저 넣어 섹션이 접히지 않게 한 뒤 이미지 삽입.
    await descEditor(panel).fill("inline image annotation e2e");
    await panel.getByTestId("section-image-input-description").setInputFiles({
      name: "shot.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    // 삽입은 IndexedDB 저장 + blob URL 표시라 비동기 — img 표시까지 대기.
    await expect(descEditor(panel).locator("img")).toBeVisible();
  });

  test.afterAll(async () => {
    await panel?.close();
    await fixture?.close();
  });

  test("hover 시 주석·삭제 버튼 노출, 초기화 버튼은 숨김", async () => {
    const wrapper = descEditor(panel).locator(".inline-image").first();
    await wrapper.hover();

    // 주석·삭제는 존재. (opacity 0→1은 Playwright visible 판정과 무관하므로 그룹 opacity로 hover를 판정)
    await expect(panel.getByTestId("inline-image-annotate")).toBeVisible();
    await expect(panel.getByTestId("inline-image-delete")).toBeVisible();
    // 어노테이션 기록이 없으니 초기화는 hidden 속성으로 숨김(display:none → not visible).
    await expect(panel.getByTestId("inline-image-reset")).toBeHidden();
    // hover 시 액션 그룹이 드러난다(기본 opacity:0 → 1).
    await expect(descEditor(panel).locator(".block-actions").first()).toHaveCSS(
      "opacity",
      "1",
    );
  });

  test("주석 버튼 → 어노테이션 오버레이 진입 → 취소 시 이미지 유지", async () => {
    await descEditor(panel).locator(".inline-image").first().hover();
    await panel.getByTestId("inline-image-annotate").click();

    // 오버레이는 createPortal(document.body)로 뜬다.
    await expect(panel.getByTestId("annotation-overlay")).toBeVisible();

    // 도형 없이 취소 → 오버레이 닫힘, 이미지 그대로(변경 없음).
    await panel.getByTestId("annotation-cancel").click();
    await expect(panel.getByTestId("annotation-overlay")).toHaveCount(0);
    await expect(descEditor(panel).locator("img")).toBeVisible();
  });

  test("삭제 버튼 → 본문에서 이미지 제거", async () => {
    await descEditor(panel).locator(".inline-image").first().hover();
    await panel.getByTestId("inline-image-delete").click();

    await expect(descEditor(panel).locator("img")).toHaveCount(0);
    // 본문 텍스트는 남는다(이미지 노드만 제거).
    await expect(descEditor(panel)).toContainText("inline image annotation e2e");
  });
});
