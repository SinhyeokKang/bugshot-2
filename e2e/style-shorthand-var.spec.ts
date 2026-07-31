import type { Page } from "@playwright/test";
import { enterDebugAndPick, expect, pickElement, test } from "./fixtures/extension";

// style-shorthand-var: var()가 낀 shorthand의 specified 복원을 **실제 Chrome CSSOM 위에서**
// 고정한다. 단위 테스트는 `all`/`declared` 맵을 손으로 만들어 넣으므로 이 픽스의 전제
// 자체(브라우저가 무엇을 돌려주는가)를 검증하지 못한다 — 그 공백이 이 spec의 존재 이유다.
//
// 고정하는 전제 4가지:
//  1. var()가 낀 shorthand는 CSSOM longhand가 전부 빈 문자열 → 수동 전개가 유일한 출처
//  2. 논리 속성(padding-inline)은 var() 없이도 물리 longhand로 explode되지 않는다
//  3. `*{border:0}` 리셋은 CSSOM이 0px/none/currentcolor로 explode한다
//  4. 규칙 순서·중요도가 그 전개의 소유권 판정에 반영된다
//
// 판정축은 CSS 코드 뷰(specified 전량이 직렬화돼 나온다)를 주로 쓰고, 원 신고 화면인
// 편집 탭 Border 섹션도 함께 본다. styleEditorView는 settings 영속이라 afterAll에서 복원.
test.describe.serial("style-shorthand-var", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("shorthand-var.html"));
    // 픽스처 전제 확인 — 리셋과 토큰 border가 실제로 적용됐어야 회귀가 드러난다.
    await expect(fixture.locator("#tokened")).toHaveCSS(
      "border-top-color",
      "rgb(51, 102, 204)",
    );
    await expect(fixture.locator("#logical")).toHaveCSS("padding-left", "4px");
    const tabId = await ext.fixtureTabId("http://127.0.0.1/shorthand-var.html");
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async ({ ext }) => {
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

  async function openCodeView() {
    await panel.getByTestId("style-view-code").click();
    await expect(panel.getByTestId("style-css-view")).toBeVisible();
  }

  async function openFormView() {
    await panel.getByTestId("style-view-form").click();
    await expect(panel.getByTestId("style-css-view")).toBeHidden();
  }

  // 다음 요소로 넘어간다. CSS 뷰는 요소 전환 시 key remount로 doc을 재파생하므로,
  // 셀렉터 줄이 새 요소로 바뀔 때까지 기다려야 stale doc을 읽지 않는다.
  async function repickAndRead(selector: string) {
    await panel.getByTestId("repick").click();
    await expect(panel.getByTestId("repick")).toBeHidden();
    await pickElement(fixture, panel, selector);
    await expect(panel.getByTestId("repick")).toBeVisible();
    await expect(cm()).toContainText(selector);
    return (await cm().innerText()).replace(/\s+/g, " ");
  }

  test("1. 리셋 뒤의 var() border가 편집 탭에 실제 값으로 뜬다", async () => {
    await enterDebugAndPick(fixture, panel, "#tokened");

    // 회귀 시엔 리셋이 explode한 0px/none/currentcolor가 그대로 노출됐다.
    const width = panel
      .locator("section")
      .getByText("border-width", { exact: true })
      .locator("..")
      .locator("button")
      .first();
    await expect(width).toHaveText("0.1rem");
  });

  test("2. CSS 뷰의 border 선언이 서로 모순되지 않는다", async () => {
    await openCodeView();
    const text = (await cm().innerText()).replace(/\s+/g, " ");

    expect(text).toContain("border: 0.1rem solid var(--divider)");
    expect(text).toContain("border-width: 0.1rem");
    expect(text).toContain("border-style: solid");
    expect(text).toContain("border-color: var(--divider)");
    // 리셋 값이 한 줄이라도 남으면 shorthand와 자기모순이 된다.
    expect(text).not.toContain("border-style: none");
    expect(text).not.toContain("border-width: 0px");
    expect(text).not.toContain("border-color: currentcolor");
  });

  test("3. 논리 속성 2값이 물리 longhand로 갈린다", async () => {
    const text = await repickAndRead("#logical");

    expect(text).toContain("padding-left: 4px");
    expect(text).toContain("padding-right: 8px");
    // 회귀 시엔 두 면에 값이 통째로 복사됐다.
    expect(text).not.toContain("padding-left: 4px 8px");
    expect(text).not.toContain("padding-right: 4px 8px");
  });

  test("4. var()가 낀 transition은 shorthand로 살아남는다", async () => {
    const text = await repickAndRead("#trans");

    // longhand 4개는 CSSOM에서 전부 빈 값이라 shorthand가 유일한 노출 경로다.
    expect(text).toContain("transition: color var(--dur)");
  });

  test("5. calc 안의 나눗셈이 전개를 막지 않는다", async () => {
    const text = await repickAndRead("#calcgap");

    // 회귀 시엔 전개를 포기해 author 값이 사라지고 computed px로 폴백했다.
    expect(text).toContain("calc(var(--space-lg) / 2)");
    expect(text).not.toContain("gap: 16px");
  });

  test("6. !important 축은 뒤따르는 일반 border shorthand가 못 덮는다", async () => {
    const text = await repickAndRead("#important");

    expect(text).toContain("border-color: red");
    expect(text).not.toContain("border-color: var(--divider)");
    // 중요도가 안 걸린 축은 정상적으로 shorthand가 가져간다.
    expect(text).toContain("border-width: 1px");

    await openFormView();
  });
});
