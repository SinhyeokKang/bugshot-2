import { enterDebug, expect, test } from "./fixtures/extension";
import type { Page } from "@playwright/test";

// AI 초안 생성 — 선입력 텍스트/이미지를 컨텍스트로 전달 + 응답 적용 시 이미지 보존(텍스트만 교체).
// Chrome 빌트인 AI(Gemini Nano)는 Playwright에서 사용 불가(useAI가 availability로 판정)이므로
// BYOK(openai-compatible) 경로를 쓴다: settings에 더미 llm을 seed해 status=available로 만들고
// panel.route로 /chat/completions를 고정 JSON으로 mock한다.

const LLM_SEED = {
  baseUrl: "https://mock-llm.test/v1", // api.anthropic.com이 아니라 openai-compatible로 판정
  apiKey: "",
  modelId: "mock-model",
};

// mock이 돌려줄 초안(JSON). description은 이미지 보존 검증의 텍스트 교체 대상.
const MOCK_DRAFT = {
  title: "MOCK TITLE",
  description: "MOCK DESCRIPTION",
  stepsToReproduce: "mock step",
  expectedResult: "mock expected",
};

// 1x1 PNG (inline 이미지 삽입용)
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

const descEditor = (panel: Page) =>
  panel.getByTestId("draft-section-description").locator('[contenteditable="true"]');
const expectedEditor = (panel: Page) =>
  panel.getByTestId("draft-section-expectedResult").locator('[contenteditable="true"]');

async function generate(panel: Page, prompt: string): Promise<void> {
  await panel.getByTestId("ai-draft-trigger").click();
  await panel.getByTestId("ai-draft-input").fill(prompt);
  await panel.getByTestId("ai-draft-submit").click();
}

test.describe.serial("AI 초안 — 선입력 컨텍스트 & 이미지 보존 (BYOK mock)", () => {
  let fixture: Page;
  let panel: Page;
  const requests: unknown[] = [];

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);

    // BYOK llm seed → reload로 persist hydrate (status=available)
    await panel.evaluate((llm) => {
      return chrome.storage.local.set({
        "bugshot-app-settings": JSON.stringify({ state: { llm }, version: 5 }),
      });
    }, LLM_SEED);
    await panel.reload();

    // LLM 엔드포인트 mock — 받은 body를 캡처하고 고정 초안 반환
    await panel.route("**/chat/completions", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify(MOCK_DRAFT) } }],
        }),
      });
    });

    await enterDebug(panel);
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  });

  test.afterAll(async () => {
    await panel?.close();
    await fixture?.close();
  });

  test("선입력 텍스트가 요청 payload에 포함되고 이미지 없는 섹션은 mock 텍스트로 교체", async () => {
    await descEditor(panel).fill("USER PREFILLED TEXT");
    requests.length = 0;

    await generate(panel, "make it better");

    await expect(descEditor(panel)).toContainText("MOCK DESCRIPTION");
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(requests[0])).toContain("USER PREFILLED TEXT");
  });

  test("이미지 있는 섹션은 이미지 보존 + 텍스트 교체, 요청 payload에 이미지 포함", async () => {
    await panel.getByTestId("section-image-input-description").setInputFiles({
      name: "shot.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    // inline 이미지 삽입(IndexedDB 저장 + blob URL 표시) 완료 대기
    await expect(descEditor(panel).locator("img")).toBeVisible();

    requests.length = 0;
    await generate(panel, "again");

    // 텍스트는 mock으로 교체되고 이미지는 보존
    await expect(descEditor(panel)).toContainText("MOCK DESCRIPTION");
    await expect(descEditor(panel).locator("img")).toBeVisible();

    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(requests[0])).toContain("image_url");
  });

  test("재생성 시 그 시점의 최신 선입력이 payload에 반영", async () => {
    await expectedEditor(panel).fill("LATEST PREFILL VALUE");
    requests.length = 0;

    await generate(panel, "regenerate");

    await expect(expectedEditor(panel)).toContainText("mock expected");
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(JSON.stringify(requests[0])).toContain("LATEST PREFILL VALUE");
  });
});
