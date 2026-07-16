import type { Page } from "@playwright/test";
import { enterDebugAndPick, expect, test } from "./fixtures/extension";

// style-code-value-hints: CSS 코드 뷰 값 자동완성이 property-aware인지.
// 속성별 값(border-collapse→collapse, overflow→scroll)이 콤보박스에 뜬다 —
// 과거 generic 덤프엔 누락됐던 값. propValues.PROP_VALUES 단일 출처 회귀 가드.
const mod = process.platform === "darwin" ? "Meta" : "Control";

test.describe.serial("style-code-value-hints", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async ({ ext }) => {
    // 코드 모드가 영속에 남으면 폼 기본을 가정하는 후행 style spec이 깨진다 → form 복원.
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

  const option = (text: string) =>
    panel.locator(".cm-tooltip-autocomplete li", { hasText: text }).first();

  test("속성별 값이 콤보박스에 뜬다 (generic 덤프엔 없던 값)", async () => {
    await enterDebugAndPick(fixture, panel, "#tbl");
    await panel.getByTestId("style-view-code").click();
    const cm = panel.getByTestId("style-css-view").locator(".cm-content");
    await expect(cm).toBeVisible();

    // 커서를 } 앞으로.
    await cm.click();
    await panel.keyboard.press(`${mod}+a`);
    await panel.keyboard.press("ArrowRight");
    await panel.keyboard.press("ArrowLeft");

    // border-collapse 값: collapse (과거 [center,checked,cue,currentColor]엔 없음).
    await panel.keyboard.type("border-collapse: c");
    await expect(option("collapse")).toBeVisible();
    await panel.keyboard.press("Escape");

    // 폼 지원 속성(overflow)도 같은 개선 — scroll (과거 generic 덤프엔 없음).
    await panel.keyboard.press("End");
    await panel.keyboard.type("; overflow: s");
    await expect(option("scroll")).toBeVisible();
    await panel.keyboard.press("Escape");
  });
});
