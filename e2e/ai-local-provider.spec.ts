import { enterDebug, expect, test } from "./fixtures/extension";
import type { Page } from "@playwright/test";

// 로컬 BYOK 엔드포인트(Ollama 등) = compact 좌표(`LOCAL_BYOK_CAPABILITIES`):
// 이미지 미전송 + 좁은 컨텍스트 예산(기존 초안 400자 캡).
// ai-draft.spec과 같은 BYOK mock 패턴이되 baseUrl만 loopback이라 능력 좌표가 갈린다.
//
// 두 회귀를 건다:
//  1) 이미지를 못 받는 프로바이더에 스크린샷/inline 이미지를 실어 보내면 조용히 버려지는데
//     프롬프트만 "이미지를 분석하라"고 지시해 환각이 된다 → payload에 image_url 부재.
//  2) 예산 캡으로 프롬프트에서 빠진 기존 초안(제목·섹션)은 모델이 본 적이 없다. 그 자리에
//     모델이 지어낸 텍스트를 쓰면 사용자 원문이 조용히 소실된다 → 원문 보존.

const LLM_SEED = {
  baseUrl: "http://localhost:11434/v1", // loopback → compact·이미지 불가·좁은 예산
  apiKey: "",
  modelId: "mock-local-model",
};

const MOCK_DRAFT = {
  title: "MOCK TITLE",
  description: "MOCK DESCRIPTION",
  stepsToReproduce: "mock step",
  expectedResult: "mock expected",
};

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

// compact 캡(existingDraftChars=400)을 넘겨 프롬프트에서 통째로 빠지게 한다.
const LONG_TITLE = `KEEPTITLE ${"t".repeat(450)}`;
const LONG_DESC = `KEEPDESC ${"d".repeat(500)}`;
const SHORT_PREV = "SHORTPREV note";

const descEditor = (panel: Page) =>
  panel.getByTestId("draft-section-description").locator('[contenteditable="true"]');
const expectedEditor = (panel: Page) =>
  panel.getByTestId("draft-section-expectedResult").locator('[contenteditable="true"]');

async function generate(panel: Page, prompt: string): Promise<void> {
  await panel.getByTestId("ai-draft-trigger").click();
  await panel.getByTestId("ai-draft-input").fill(prompt);
  await panel.getByTestId("ai-draft-submit").click();
}

test.describe.serial("AI 초안 — 로컬 BYOK(compact 좌표)", () => {
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

  test("inline 이미지가 있어도 payload에 이미지를 안 싣는다", async () => {
    await panel.getByTestId("section-image-input-description").setInputFiles({
      name: "shot.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });
    await expect(descEditor(panel).locator("img")).toBeVisible();

    requests.length = 0;
    await generate(panel, "describe the bug");

    await expect(descEditor(panel)).toContainText("MOCK DESCRIPTION");
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    // 이미지는 실리지 않지만 inline 이미지 자체는 본문에 보존된다.
    expect(JSON.stringify(requests[0])).not.toContain("image_url");
    await expect(descEditor(panel).locator("img")).toBeVisible();
  });

  test("예산 캡으로 프롬프트에서 빠진 제목·섹션은 AI 응답이 덮지 않는다", async () => {
    // 제목 Input은 onFocus에서 rAF로 커서를 끝으로 옮긴다 — fill의 select-all과 경합해
    // 기존 값 뒤에 덧붙는다. 먼저 포커스를 잡고 rAF가 정착한 뒤 fill해야 교체가 보장된다.
    const titleInput = panel.getByTestId("draft-title");
    await titleInput.click();
    await panel.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await titleInput.fill(LONG_TITLE);
    await descEditor(panel).fill(LONG_DESC);
    // 대조군: 캡 안에 드는 짧은 원문 — 프롬프트에 실리므로 AI가 정상 교체해야 한다.
    await expectedEditor(panel).fill(SHORT_PREV);

    requests.length = 0;
    await generate(panel, "improve it");

    // 모델이 못 본 제목·본문은 원문 유지 — 지어낸 텍스트가 들어오지 않는다.
    await expect(panel.getByTestId("draft-title")).toHaveValue(LONG_TITLE);
    await expect(descEditor(panel)).toContainText("KEEPDESC");
    await expect(descEditor(panel)).not.toContainText("MOCK DESCRIPTION");

    // 보존이 과잉이 아님 — 실제로 실린 섹션은 AI 텍스트로 교체된다.
    await expect(expectedEditor(panel)).toContainText("mock expected");

    // payload로 확인: 긴 원문은 빠지고 짧은 원문만 실렸다.
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    const body = JSON.stringify(requests[0]);
    expect(body).not.toContain("KEEPDESC");
    expect(body).not.toContain("KEEPTITLE");
    expect(body).toContain(SHORT_PREV);
  });
});
