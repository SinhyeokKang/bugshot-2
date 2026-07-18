import { enterDebug, expect, test } from "./fixtures/extension";
import type { Page } from "@playwright/test";

// AI 초안 logRefs — AI가 지목한 로그를 앱이 description에 코드블럭으로 삽입하는 경로.
// 유닛으로 못 보는 유일한 구간(tiptap 마크다운 왕복 → 실제 codeBlock 노드)을 여기서 증명한다.
// BYOK mock(비-loopback → rich 좌표) + 가변 mockDraft로 시나리오별 logRefs를 갈아끼운다.

const LLM_SEED = {
  baseUrl: "https://mock-llm.test/v1",
  apiKey: "",
  modelId: "mock-model",
};

// route 핸들러가 매 요청 읽는 가변 초안 — 시나리오마다 logRefs·description을 바꾼다
// (description을 런마다 다르게 해야 "이번 런이 적용됐다"를 텍스트로 판정 가능).
let mockDraft: Record<string, unknown> = {};

const descEditor = (panel: Page) =>
  panel.getByTestId("draft-section-description").locator('[contenteditable="true"]');
// 블록 개수는 pre 카운트로 판정 — CodeCollapseNodeView가 <pre>를 직접 생성하므로 유효하고,
// code-collapse 셸(testid)은 15줄 초과 블록에만 붙어 짧은 로그 블록을 못 센다. 스위트에
// pre locator 선례가 없어 근거를 남긴다(기존 관례 preview-section-*는 preview 전환이 필요해
// drafting 내 재생성 루프 판정에 부적합).
const descBlocks = (panel: Page) => descEditor(panel).locator("pre");

async function generate(panel: Page, prompt: string): Promise<void> {
  await panel.getByTestId("ai-draft-trigger").click();
  await panel.getByTestId("ai-draft-input").fill(prompt);
  await panel.getByTestId("ai-draft-submit").click();
}

test.describe.serial("AI 초안 logRefs — 로그 코드블럭 자동 삽입 (BYOK mock)", () => {
  let fixture: Page;
  let panel: Page;

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

    // route는 reload 후 설정. 가변 mockDraft를 매 요청 시점에 읽는다.
    await panel.route("**/chat/completions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify(mockDraft) } }],
        }),
      });
    });

    await enterDebug(panel);

    // 후보 로그 시딩(idle) — 콘솔 에러 1건(c1 후보)·정상 네트워크 1건(수동 삽입용, 200이라
    // 후보 아님 — AI dedup과 간섭 없음). 레코더 활성화까지 발생+sync 폴링(logs-error-warn 관례).
    // 같은 메시지를 재발행해도 first-line dedup으로 후보는 1개 — c1 결정성 유지.
    await panel.getByTestId("subtab-console").click();
    await expect(async () => {
      await fixture.evaluate(() => console.error("ZQX_LOGREF_ERR boom"));
      await panel.waitForTimeout(1700);
      await expect(
        panel.locator('[data-entry-id][data-level="error"]', { hasText: "ZQX_LOGREF_ERR" }),
      ).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    await panel.getByTestId("subtab-network").click();
    await expect(async () => {
      await fixture.evaluate(() => fetch("/e2e-json?logref=" + performance.now()).catch(() => {}));
      await panel.waitForTimeout(1700);
      await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // 캡처 모드 버튼은 issue 서브탭에 있다.
    await panel.getByTestId("subtab-issue").click();
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  });

  test.afterAll(async () => {
    await panel?.close();
    await fixture?.close();
  });

  test("logRefs [] → 코드블럭이 붙지 않는다 (관련 로그 없음이 정상)", async () => {
    mockDraft = {
      title: "MOCK TITLE",
      description: "MOCK DESC RUN1",
      stepsToReproduce: "step",
      expectedResult: "expected",
      logRefs: [],
    };
    await generate(panel, "empty refs");

    await expect(descEditor(panel)).toContainText("MOCK DESC RUN1");
    await expect(descBlocks(panel)).toHaveCount(0);
  });

  test("후보에 없는 ref(n9) → 조용히 스킵, 코드블럭 0", async () => {
    mockDraft = { ...mockDraft, description: "MOCK DESC RUN2", logRefs: ["n9"] };
    await generate(panel, "unknown ref");

    await expect(descEditor(panel)).toContainText("MOCK DESC RUN2");
    await expect(descBlocks(panel)).toHaveCount(0);
  });

  test("AI가 c1 지목 → 실제 콘솔 로그가 코드블럭 1개로 삽입된다", async () => {
    mockDraft = { ...mockDraft, description: "MOCK DESC RUN3", logRefs: ["c1"] };
    await generate(panel, "point c1");

    await expect(descEditor(panel)).toContainText("MOCK DESC RUN3");
    await expect(descBlocks(panel)).toHaveCount(1);
    // 블록 내용이 store 원본 로그다 — AI 산문이 아니라 (id-only 불변식의 사용자 가시 증거).
    await expect(descBlocks(panel).first()).toContainText("ZQX_LOGREF_ERR");
  });

  test("같은 ref로 재생성해도 블록이 늘지 않는다 (Tiptap 왕복 dedup)", async () => {
    mockDraft = { ...mockDraft, description: "MOCK DESC RUN4", logRefs: ["c1"] };
    await generate(panel, "regenerate same ref");

    await expect(descEditor(panel)).toContainText("MOCK DESC RUN4");
    await expect(descBlocks(panel)).toHaveCount(1);
  });

  test("수동 삽입 블록은 AI 재생성 후에도 남는다", async () => {
    // 수동으로 정상(200) 네트워크 로그 삽입 — 후보가 아니라 AI dedup과 무관한 별개 블록.
    const dialog = panel.getByTestId("log-insert-dialog");
    await panel.getByTestId("section-log-insert-description").click();
    await expect(dialog).toBeVisible();
    // 비활성 탭(console) 행이 hidden으로 DOM에 남는다 — :visible + 네트워크 행 텍스트로 특정.
    await dialog.locator('[data-entry-id]:visible', { hasText: "/e2e-json" }).first().click();
    await expect(panel.getByTestId("log-insert-confirm")).toBeEnabled();
    await panel.getByTestId("log-insert-confirm").click();
    await expect(dialog).toBeHidden();
    await expect(descBlocks(panel)).toHaveCount(2);

    mockDraft = { ...mockDraft, description: "MOCK DESC RUN5", logRefs: ["c1"] };
    await generate(panel, "after manual insert");

    await expect(descEditor(panel)).toContainText("MOCK DESC RUN5");
    // 수동 네트워크 블록 보존 + c1은 dedup — 2개 유지.
    await expect(descBlocks(panel)).toHaveCount(2);
    await expect(descEditor(panel)).toContainText("/e2e-json");
    await expect(descEditor(panel)).toContainText("ZQX_LOGREF_ERR");
  });
});
