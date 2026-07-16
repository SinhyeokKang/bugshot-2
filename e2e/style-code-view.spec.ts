import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  expect,
  pickElement,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// style-code-view: 요소 스타일 편집의 편집(폼)/CSS(코드) 2탭 + CodeMirror CSS 뷰.
// - 탭 스왑(CSS 탭에서 class·Text·폼 섹션 hidden, 에디터 노출)
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

  test("탭 스왑 — CSS 탭에서 class·Text·폼 섹션 숨김, 에디터 노출", async () => {
    await enterDebugAndPick(fixture, panel, "#title");

    // #title은 class 없음 → Class 섹션 접힘 기본값. 폼 에디터 노출 검증 위해 펼친다.
    await panel.getByTestId("section-class-toggle").click();

    // 기본 편집(폼) 모드: 토글 노출, class·Text 노출, CSS 뷰 미마운트.
    await expect(panel.getByTestId("style-view-toggle")).toBeVisible();
    await expect(panel.getByTestId("class-editor")).toBeVisible();
    await expect(panel.getByTestId("text-editor")).toBeVisible();
    await expect(panel.getByTestId("style-css-view")).toBeHidden();

    // CSS 전환: 에디터 노출, class·Text 섹션 hidden(폼 전용).
    await panel.getByTestId("style-view-code").click();
    await expect(panel.getByTestId("style-css-view")).toBeVisible();
    await expect(cm()).toBeVisible();
    await expect(panel.getByTestId("class-editor")).toBeHidden();
    await expect(panel.getByTestId("text-editor")).toBeHidden();
  });

  test("CSS prefill — specified(color·padding) shorthand 병합 표시, 무편집 시 변경 0", async () => {
    // #title specified(color·padding)가 selector 블록에 prefill돼 있다.
    await expect(cm()).toContainText("color");
    // 4면 동일 padding(8px)은 shorthand 한 줄로 병합 — longhand 미노출.
    await expect(cm()).toContainText("padding: 8px");
    await expect(cm()).not.toContainText("padding-top");
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
    // padding-top은 shorthand 병합돼 `padding: 32px …`로 표시되므로 값(32px)으로 단언.
    await panel.getByTestId("style-view-code").click();
    await expect(cm()).toContainText("#00ff00");
    await expect(cm()).toContainText("32px");
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

  // 빌드가 Geist를 실제로 실었는지는 단위 테스트가 말할 수 없다 — tailwind.config.js 소스만 읽기
  // 때문. @import를 @tailwind 아래로 옮기면 postcss-import가 경고만 내고 빌드는 통과하는데
  // woff2는 0개 emit된다(실측) — 콘솔 경고 없이 조용히 폴백하므로 이 단언이 유일한 자동 그물이다.
  //
  // document.fonts.check()는 쓰지 말 것: 매칭 @font-face가 **없으면** 그 family는 시스템 폰트로
  // 폴백되고 폴백은 늘 available이라 true를 돌려준다 — 폰트가 빠져도 통과하는 공허한 단언이 된다
  // (실측 확인). getComputedStyle().fontFamily도 스택 문자열만 돌려줘 해석 결과를 말하지 않는다.
  // 그래서 @font-face 등록 자체를 document.fonts에서 직접 확인한다.
  test("Geist Mono @font-face가 실제로 실려 로드된다 — font-mono가 폴백으로 새지 않는다", async () => {
    const faces = await panel.evaluate(async () => {
      // unicode-range 서브셋은 글리프를 그릴 때 지연 로드된다 — load()로 명시적으로 받아야
      // 화면에 mono 텍스트가 있든 없든 status가 결정적이다.
      await document.fonts.load('13px "Geist Mono Variable"');
      return [...document.fonts]
        .filter((f) => f.family.replace(/["']/g, "") === "Geist Mono Variable")
        .map((f) => f.status);
    });
    expect(faces.length).toBeGreaterThan(0);
    expect(faces).toContain("loaded");
  });
});
