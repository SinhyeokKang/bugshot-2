import { enterDebugAndPick, expect, test } from "./fixtures/extension";
import type { Page } from "@playwright/test";

// AI 스타일링(AiStylingDialog) — BYOK(openai-compatible) mock.
// 빌트인 AI는 Playwright에서 불가(useAI availability)라 llm seed + panel.route로 mock한다(ai-draft.spec과 동일 패턴).
// AI 응답의 inlineStyle이 styleEdits에 머지되어 변경사항 다이얼로그·페이지 DOM에 반영되는지 검증.

const LLM_SEED = {
  baseUrl: "https://mock-llm.test/v1",
  apiKey: "",
  modelId: "mock-model",
};

// mock이 돌려줄 스타일 초안. inlineStyle은 fixture 페이지에 적용·변경행으로 판정.
// 테스트별로 갈아끼운다(두 번째 AI 턴은 doc이 실제로 바뀌어야 재동기화 경로를 탄다).
let mockStyling: { explanation: string; inlineStyle: Record<string, string> } = {
  explanation: "make background green with padding",
  inlineStyle: { backgroundColor: "rgb(0, 128, 0)", padding: "16px" },
};

test.describe.serial("AI 스타일링 (BYOK mock)", () => {
  let fixture: Page;
  let panel: Page;
  const requests: unknown[] = [];

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);

    await panel.evaluate((llm) => {
      return chrome.storage.local.set({
        "bugshot-app-settings": JSON.stringify({ state: { llm }, version: 5 }),
      });
    }, LLM_SEED);
    await panel.reload();

    await panel.route("**/chat/completions", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify(mockStyling) } }],
        }),
      });
    });

    await enterDebugAndPick(fixture, panel, "#title");
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
    await panel?.close();
    await fixture?.close();
  });

  test("AI 스타일링 → mock inlineStyle이 페이지·변경사항에 적용되고 요청 발생", async () => {
    await expect(panel.getByTestId("ai-styling-trigger")).toBeVisible();
    await panel.getByTestId("ai-styling-trigger").click();
    await panel.getByTestId("ai-styling-input").fill("make it green with 16px padding");

    requests.length = 0;
    await panel.getByTestId("ai-styling-submit").click();

    // mock 엔드포인트 호출 발생
    await expect.poll(() => requests.length).toBeGreaterThan(0);

    // 페이지 DOM에 즉시 적용(applyStyles)
    await expect(fixture.locator("#title")).toHaveCSS("background-color", "rgb(0, 128, 0)");
    await expect(fixture.locator("#title")).toHaveCSS("padding", "16px");

    // 변경사항 다이얼로그에 해당 prop 행 노출
    await panel.getByTestId("changes-trigger").click();
    await expect(panel.getByTestId("changes-dialog")).toBeVisible();
    await expect(
      panel.locator('[data-testid="changes-row"][data-prop="background-color"]'),
    ).toBeVisible();
    await expect(
      panel.locator('[data-testid="changes-row"][data-prop="padding"]'),
    ).toBeVisible();
  });

  test("요청 payload에 선택 요소의 스타일 컨텍스트가 포함", async () => {
    // 요소 컨텍스트(현재 스타일 스냅샷)가 prompt에 실려 나간다 — padding은 #title의 specified prop.
    expect(requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(requests[0])).toContain("padding");
  });

  // 회귀: CSS 코드 뷰에 머문 채 AI 스타일링을 돌리면 doc이 프로그램적으로 전체 교체되는데,
  // selectorLock의 protected range가 그 교체와 겹쳐 삽입분을 드롭 → 선택자 1행만 남고 본문 전멸.
  // (탭을 왕복하면 remount로 복구돼 증상이 가려진다 — CSS 탭에 머문 채 판정해야 한다.)
  test("CSS 탭 유지 상태에서 AI 스타일링 → 코드 뷰 본문 선언이 보존된다", async () => {
    await panel.keyboard.press("Escape");
    await expect(panel.getByTestId("changes-dialog")).toBeHidden();

    await panel.getByTestId("style-view-code").click();
    const cm = panel.getByTestId("style-css-view").locator(".cm-content");
    await expect(cm).toContainText("color");
    await expect(cm).toContainText("padding");

    // 두 번째 AI 턴 — 새 값이라야 doc이 실제로 바뀌어 재동기화(전체 교체) 경로를 탄다.
    mockStyling = {
      explanation: "round the corners",
      inlineStyle: { borderRadius: "999px" },
    };
    await panel.getByTestId("ai-styling-trigger").click();
    await panel.getByTestId("ai-styling-input").fill("모서리를 둥글게");
    await panel.getByTestId("ai-styling-submit").click();

    await expect(fixture.locator("#title")).toHaveCSS("border-radius", "999px");

    // AI가 넣은 선언 + 기존 specified 선언이 함께 남아야 한다.
    await expect(cm).toContainText("border-radius");
    await expect(cm).toContainText("color");
    await expect(cm).toContainText("padding");
    // 선택자 1행으로 붕괴하지 않았다.
    expect(await cm.locator(".cm-line").count()).toBeGreaterThan(3);
  });
});
