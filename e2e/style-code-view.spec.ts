import type { Page } from "@playwright/test";
import {
  enterDebugAndPick,
  ensureSectionOpen,
  expect,
  pickElement,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// style-code-view: 요소 스타일 편집의 폼/코드 두 모드 토글 + raw CSS textarea.
// - 토글 노출·모드 스왑(공통 섹션 유지) / 코드 입력 라이브 적용 + 변경 다이얼로그
// - 폼↔코드 양방향 동기화 무손실 / 폼 미지원 임의 속성 왕복 유지
// - 버퍼 다중요소 코드 모드 복원(최고위험) / 코드 모드 영속 재진입
// - form 회귀: collapsible 접힘 상태 왕복 보존(hidden 리팩터 — 언마운트였으면 리셋)
//
// styleEditorView는 settings-ui-store 영속이라 후행 spec으로 샌다 → afterAll에서 form 복원.
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

  const code = () => panel.getByTestId("style-code-editor");
  const trigger = () => panel.getByTestId("changes-trigger");
  const dialog = () => panel.getByTestId("changes-dialog");
  const currentCard = () =>
    panel.locator('[data-testid="changes-card"][data-source="current"]');

  test("토글 노출 + 코드 전환 시 폼 섹션 숨김·코드 에디터 노출(공통 섹션 유지)", async () => {
    await enterDebugAndPick(fixture, panel, "#title");

    // 기본 form 모드: 토글 노출, 코드 에디터 숨김, 폼 필드·class 섹션(공통) 노출.
    await expect(panel.getByTestId("style-view-toggle")).toBeVisible();
    await expect(code()).toBeHidden();
    await expect(panel.getByTestId("class-editor")).toBeVisible();
    await expect(panel.getByText("padding", { exact: true })).toBeVisible();

    // 코드 전환: 코드 에디터 노출, 폼 필드 숨김(hidden), class 섹션은 공통이라 유지.
    await panel.getByTestId("style-view-code").click();
    await expect(code()).toBeVisible();
    await expect(panel.getByText("padding", { exact: true })).toBeHidden();
    await expect(panel.getByTestId("class-editor")).toBeVisible();
  });

  test("코드 textarea 입력 → 페이지 라이브 적용 + 변경사항 다이얼로그에 잡힘", async () => {
    await code().fill("padding-top: 32px;");
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

  test("폼↔코드 양방향 동기화 무손실 — 폼 편집이 코드 textarea에 재동기화", async () => {
    // 폼 전환: 코드로 넣은 padding-top이 유지된다.
    await panel.getByTestId("style-view-form").click();
    await expect(fixture.locator("#title")).toHaveCSS("padding-top", "32px");

    // 폼에서 color 편집 → 라이브 적용.
    await typeStyleValue(panel, "color", "#00ff00");
    await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(0, 255, 0)");

    // 코드 전환: 폼 편집(color)이 외부 변경으로 textarea에 재동기화 + padding-top 유지.
    await panel.getByTestId("style-view-code").click();
    await expect(code()).toHaveValue(/padding-top: 32px;/);
    await expect(code()).toHaveValue(/color: #00ff00;/);
  });

  test("폼 미지원 임의 속성(cursor)이 폼↔코드 왕복에도 코드에 유지", async () => {
    // 코드에 폼이 못 다루는 속성만 남긴다(fill은 전체 교체).
    await code().fill("cursor: pointer;");
    await expect(fixture.locator("#title")).toHaveCSS("cursor", "pointer");

    // 폼 왕복: 폼은 cursor 컨트롤이 없어 건드리지 못하므로 코드에 그대로 남는다.
    await panel.getByTestId("style-view-form").click();
    await panel.getByTestId("style-view-code").click();
    await expect(code()).toHaveValue(/cursor: pointer;/);
    await expect(fixture.locator("#title")).toHaveCSS("cursor", "pointer");
  });

  test("버퍼 다중요소 + 코드 모드 — 다른 요소 repick 후 재선택 시 편집 복원", async () => {
    // #title에 코드 편집(outline) → repick으로 #card(A 버퍼링) → #title 재선택 시 복원.
    await code().fill("outline: 2px solid rgb(255, 0, 0);");
    await expect(fixture.locator("#title")).toHaveCSS("outline-color", "rgb(255, 0, 0)");

    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#card");
    await expect(panel.getByTestId("repick")).toBeVisible();
    // #card는 편집 이력이 없어 코드 textarea가 빈다(코드 모드 유지 증명).
    await expect(code()).toHaveValue("");

    // #title 재선택 → 버퍼 복원 → onElementSelected 복원이 textarea에 재동기화.
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, "#title");
    await expect(panel.getByTestId("repick")).toBeVisible();
    await expect(code()).toHaveValue(/outline: 2px solid/);
    await expect(fixture.locator("#title")).toHaveCSS("outline-color", "rgb(255, 0, 0)");
  });

  test("form 회귀 — collapsible 접힘 상태가 코드↔폼 왕복에도 보존(hidden 리팩터)", async () => {
    // #title 선택 상태. 폼 전환 후 기본 접힌 Position 섹션을 펼친다.
    await panel.getByTestId("style-view-form").click();
    await ensureSectionOpen(panel, "section-position-toggle", "z-index");
    await expect(panel.getByText("z-index", { exact: true })).toBeVisible();

    // 코드 왕복: hidden(display:none, 마운트 유지)이라 Section open state가 보존된다.
    // 조건부 언마운트였다면 재마운트로 defaultOpen(접힘)으로 리셋돼 z-index가 사라진다.
    await panel.getByTestId("style-view-code").click();
    await panel.getByTestId("style-view-form").click();
    await expect(panel.getByText("z-index", { exact: true })).toBeVisible();
  });

  test("코드 모드 영속 — 패널 재열기 후에도 코드 모드로 시작", async ({ ext }) => {
    // 코드 모드로 만들고 세션 스냅샷 debounce flush 후 패널 재열기.
    await panel.getByTestId("style-view-code").click();
    await expect(code()).toBeVisible();
    await panel.waitForTimeout(400);
    await panel.close();

    panel = await ext.openPanel(tabId);
    await enterDebugAndPick(fixture, panel, "#title");

    // styleEditorView(settings 영속)가 code라 재진입 시 코드 모드로 시작한다.
    await expect(code()).toBeVisible();
    await expect(panel.getByTestId("style-view-code")).toHaveAttribute(
      "data-state",
      "active",
    );
  });
});
