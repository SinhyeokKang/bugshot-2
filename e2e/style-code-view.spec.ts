import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  expect,
  pickElement,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// style-code-view: 요소 스타일 편집의 편집(폼)/CSS(코드) 2탭 + CodeMirror CSS 뷰.
// - 탭 스왑(CSS 탭에서 class·Text·폼 섹션 hidden, 박스모델+에디터 노출)
// - specified prefill 표시 / 무편집 시 변경 0
// - 선언 추가 라이브 적용 + 변경 다이얼로그 / 폼↔CSS 양방향 동기화
// - 폼 미지원 임의 속성(cursor) 왕복 유지 / 버퍼 다중요소 복원 / 삭제=initial 원복 / 탭 영속
//
// CodeMirror는 contenteditable(.cm-content) — fill()/toHaveValue() 불가. 타이핑은
// 블록 끝(} 직전)에 브레이스 없는 선언 append(자동완성 미수락·closeBrackets 회피),
// 삭제는 select-all+Delete. styleEditorView는 settings 영속이라 afterAll에서 form 복원.
const mod = process.platform === "darwin" ? "Meta" : "Control";

test.describe.serial("style-code-view", () => {
  let fixture: Page;
  let panel: Page;
  let tabId: number;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async ({ ext }) => {
    // 코드 모드가 영속에 남으면 폼 기본을 가정하는 후행 style spec들이 깨진다 → form 복원.
    await ext.evalInExt(async () => {
      const key = "bugshot-app-settings";
      const got = await chrome.storage.local.get(key);
      const raw = got[key] as string | undefined;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.state) {
        parsed.state.styleEditorView = "form";
        await chrome.storage.local.set({ [key]: JSON.stringify(parsed) });
      }
    });
    await panel.close();
    await fixture.close();
  });

  const cm = () => panel.getByTestId("style-css-view").locator(".cm-content");
  const trigger = () => panel.getByTestId("changes-trigger");
  const dialog = () => panel.getByTestId("changes-dialog");
  const currentCard = () =>
    panel.locator('[data-testid="changes-card"][data-source="current"]');

  // } 직전에 선언을 삽입(specified 라인 보존, last-wins로 우선). 브레이스·괄호 없는
  // 값만 — closeBrackets 미개입. Enter/Tab 안 침(자동완성 미수락) + 끝에 Escape로 팝오버 닫기.
  async function appendDecl(text: string) {
    await cm().click();
    await panel.keyboard.press(`${mod}+a`);
    await panel.keyboard.press("ArrowRight"); // 선택 해제 → 문서 끝
    await panel.keyboard.press("ArrowLeft"); // } 앞
    await panel.keyboard.type(text);
    await panel.keyboard.press("Escape");
  }

  async function clearCm() {
    await cm().click();
    await panel.keyboard.press(`${mod}+a`);
    await panel.keyboard.press("Delete");
    await panel.keyboard.press("Escape");
  }

  test("탭 스왑 — CSS 탭에서 class·Text·폼 섹션 숨김, 박스모델+에디터 노출", async () => {
    await enterDebugAndPick(fixture, panel, "#title");

    // 기본 편집(폼) 모드: 토글 노출, class·Text 노출, CSS 뷰 미마운트.
    await expect(panel.getByTestId("style-view-toggle")).toBeVisible();
    await expect(panel.getByTestId("class-editor")).toBeVisible();
    await expect(panel.getByTestId("text-editor")).toBeVisible();
    await expect(panel.getByTestId("style-css-view")).toBeHidden();

    // CSS 전환: 에디터·박스모델 노출, class·Text 섹션 hidden(폼 전용).
    await panel.getByTestId("style-view-code").click();
    await expect(panel.getByTestId("style-css-view")).toBeVisible();
    await expect(panel.getByTestId("box-model-diagram")).toBeVisible();
    await expect(cm()).toBeVisible();
    await expect(panel.getByTestId("class-editor")).toBeHidden();
    await expect(panel.getByTestId("text-editor")).toBeHidden();
  });

  test("CSS prefill — specified(color·padding) 선언 표시, 무편집 시 변경 0", async () => {
    // #title specified(color·padding)가 selector 블록에 prefill돼 있다.
    await expect(cm()).toContainText("color");
    await expect(cm()).toContainText("padding");
    // 무편집 → [다음] 비활성(오버라이드 0, phantom diff 없음).
    await expect(panel.getByTestId("next-step")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("선언 추가 → 페이지 라이브 적용 + 변경사항 다이얼로그에 그 prop만", async () => {
    await appendDecl("padding-top: 32px;");
    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "32px");

    await expect(trigger()).not.toBeDisabled();
    await trigger().click();
    await expect(dialog()).toBeVisible();
    const row = currentCard().locator('[data-prop="padding-top"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("32px");
    await panel.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  });

  test("폼↔CSS 양방향 동기화 — 폼 color 편집이 CSS 재진입 시 에디터에 반영", async () => {
    // 폼 전환: 코드로 넣은 padding-top 유지.
    await panel.getByTestId("style-view-form").click();
    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "32px");

    // 폼에서 color 편집 → 라이브 적용.
    await typeStyleValue(panel, "color", "#00ff00");
    await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(0, 255, 0)");

    // CSS 재진입: 폼 편집(color)·padding-top이 에디터에 재동기화(remount 재파생).
    await panel.getByTestId("style-view-code").click();
    await expect(cm()).toContainText("#00ff00");
    await expect(cm()).toContainText("padding-top");
  });

  test("폼 미지원 임의 속성(cursor) — CSS 추가 후 폼↔CSS 왕복에도 유지", async () => {
    await appendDecl("cursor: pointer;");
    await expect(fixture.locator("#title")).toHaveCSS("cursor", "pointer");

    await panel.getByTestId("style-view-form").click();
    await panel.getByTestId("style-view-code").click();
    await expect(cm()).toContainText("cursor");
    await expect(fixture.locator("#title")).toHaveCSS("cursor", "pointer");
  });

  test("버퍼 다중요소 — #card repick 후 #title 재선택 시 CSS 편집 복원", async () => {
    // #title 코드 편집됨(color/padding-top/cursor) → repick으로 #card 버퍼링.
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#card");
    await expect(panel.getByTestId("repick")).toBeVisible();

    // 코드 모드 유지 — #card prefill은 자기 specified(border-radius), #title의 cursor 없음.
    await expect(panel.getByTestId("style-css-view")).toBeVisible();
    await expect(cm()).toContainText("border-radius");
    await expect(cm()).not.toContainText("cursor");

    // #title 재선택 → 버퍼 복원 → 에디터에 편집 재파생.
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#title");
    await expect(panel.getByTestId("repick")).toBeVisible();
    await expect(cm()).toContainText("cursor");
    await expect(fixture.locator("#title")).toHaveCSS("cursor", "pointer");
  });

  test("삭제=원복 — CSS 선언 전체 삭제 시 specified가 initial로 원복", async () => {
    // 에디터 전체 삭제 → specified(color/padding)가 initial 오버라이드로 방출.
    await clearCm();
    await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(0, 0, 0)");
    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "0px");

    // 변경사항 다이얼로그에 color initial 원복 행.
    await expect(trigger()).not.toBeDisabled();
    await trigger().click();
    await expect(dialog()).toBeVisible();
    await expect(
      currentCard().locator('[data-prop="color"]'),
    ).toContainText("initial");
    await panel.keyboard.press("Escape");
    await expect(dialog()).toBeHidden();
  });

  test("CSS 탭 영속 — 패널 재열기 후에도 CSS 탭으로 시작", async ({ ext }) => {
    await panel.getByTestId("style-view-code").click();
    await expect(panel.getByTestId("style-css-view")).toBeVisible();
    await panel.waitForTimeout(400);
    await panel.close();

    panel = await ext.openPanel(tabId);
    await enterDebugAndPick(fixture, panel, "#title");

    // styleEditorView(settings 영속)가 code라 재진입 시 CSS 탭으로 시작한다.
    await expect(panel.getByTestId("style-css-view")).toBeVisible();
    await expect(panel.getByTestId("style-view-code")).toHaveAttribute(
      "data-state",
      "active",
    );
  });
});
