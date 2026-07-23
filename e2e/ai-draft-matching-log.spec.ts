import { enterDebug, expect, test } from "./fixtures/extension";
import type { Page } from "@playwright/test";

// AI 초안 200 매칭 증거 — 유저·캡처 컨텍스트와 exact-match된 성공(2xx) 응답을 후보로 담아
// shape 다이제스트를 프롬프트에 싣고(전송할 데이터 결정), 모델이 m*를 지목하면 원문을 삽입.
// BYOK mock(비-loopback → rich)이 판단만 대체하고, 나머지 전 배선을 결정론으로 검증한다:
//   ① 목 route가 나가는 요청 postData를 읽어 매칭 섹션·digest를 단정(토크나이저→매칭→인쇄)
//   ② 공유 캡 초과 시 에러(c*/n*) 우선 3블록 생존(전멸 회귀 방어)
// 매칭 term은 콘솔 에러에 심는다: "zqxbodyneedle"→/e2e-json 본문, "e2e-bigjson-000"→/e2e-bigjson 본문.

const LLM_SEED = { baseUrl: "https://mock-llm.test/v1", apiKey: "", modelId: "mock-model" };

let mockDraft: Record<string, unknown> = {};
let lastPrompt = ""; // 목 route가 매 요청 postData의 messages content를 여기 모은다.

const descEditor = (panel: Page) =>
  panel.getByTestId("draft-section-description").locator('[contenteditable="true"]');
const descBlocks = (panel: Page) => descEditor(panel).locator("pre");

async function generate(panel: Page, prompt: string): Promise<void> {
  await panel.getByTestId("ai-draft-trigger").click();
  await panel.getByTestId("ai-draft-input").fill(prompt);
  await panel.getByTestId("ai-draft-submit").click();
}

test.describe.serial("AI 초안 200 매칭 (BYOK mock)", () => {
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

    await panel.route("**/chat/completions", async (route) => {
      const body = route.request().postDataJSON() as
        | { messages?: { content: unknown }[] }
        | undefined;
      lastPrompt = (body?.messages ?? [])
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
        .join("\n");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(mockDraft) } }] }),
      });
    });

    await enterDebug(panel);

    // 콘솔 에러 2건 — c1/c2 후보이자 매칭 term 소스. first-line dedup으로 재발행해도 후보 1개씩.
    await panel.getByTestId("subtab-console").click();
    for (const msg of ["zqxbodyneedle field missing", "e2e-bigjson-000 extra broke"]) {
      const needle = msg.split(" ")[0];
      await expect(async () => {
        await fixture.evaluate((m) => console.error(m), msg);
        await panel.waitForTimeout(1700);
        await expect(
          panel.locator('[data-entry-id][data-level="error"]', { hasText: needle }),
        ).not.toHaveCount(0);
      }).toPass({ timeout: 30_000, intervals: [0] });
    }

    // 성공(200) 응답 2건 — 매칭 후보 모집단. 본문 마커가 위 콘솔 term과 겹쳐 매칭된다.
    await panel.getByTestId("subtab-network").click();
    for (const path of ["/e2e-json", "/e2e-bigjson"]) {
      await expect(async () => {
        await fixture.evaluate((p) => fetch(p + "?m=" + performance.now()).catch(() => {}), path);
        await panel.waitForTimeout(1700);
        await expect(panel.locator("[data-entry-id]", { hasText: path })).not.toHaveCount(0);
      }).toPass({ timeout: 30_000, intervals: [0] });
    }

    await panel.getByTestId("subtab-issue").click();
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  });

  test.afterAll(async () => {
    await panel?.close();
    await fixture?.close();
  });

  test("E2E-1 전송할 데이터 결정: 매칭 200 섹션·digest가 나가는 프롬프트 payload에 실린다", async () => {
    // logRefs:[] — 이 라운드는 삽입 없이 payload(전송할 데이터)만 검증(블록 상태 clean 유지).
    mockDraft = {
      title: "MOCK TITLE",
      description: "MOCK PAYLOAD RUN",
      stepsToReproduce: "step",
      expectedResult: "expected",
      logRefs: [],
    };
    await generate(panel, "주문 목록이 안 떠요"); // 순수 한글 — 매칭은 콘솔 term에서만 나온다

    await expect(descEditor(panel)).toContainText("MOCK PAYLOAD RUN");
    await expect(descBlocks(panel)).toHaveCount(0);

    // 나가는 프롬프트에 매칭 섹션 + 두 200의 provenance·digest가 실렸는지 (배선 전체 증명).
    expect(lastPrompt).toContain("Possibly related requests");
    expect(lastPrompt).toContain("/e2e-json");
    expect(lastPrompt).toContain("/e2e-bigjson");
    expect(lastPrompt).toContain('(matched "zqxbodyneedle")');
    expect(lastPrompt).toContain('(matched "e2e-bigjson-000")');
    expect(lastPrompt).toContain("note:str"); // /e2e-json digest (값 zqxbodyneedle 제외)
    expect(lastPrompt).toContain("items:arr[30]"); // /e2e-bigjson digest
  });

  test("E2E-2 공유 캡: 에러 2 + 매칭 2 인용 시 전멸 아니라 에러 우선 3블록", async () => {
    // 블록 상태는 직전 라운드가 logRefs:[]라 여전히 clean(0). 모델이 4개 인용.
    mockDraft = { ...mockDraft, description: "MOCK CAP RUN", logRefs: ["c1", "c2", "m1", "m2"] };
    await generate(panel, "재현이 안정적이지 않아요");

    await expect(descEditor(panel)).toContainText("MOCK CAP RUN");
    // 기존 return[](전멸)이면 0. 수정 후 에러(c*) 우선 정렬 + slice(3) → 3블록.
    await expect(descBlocks(panel)).toHaveCount(3);
    // 에러 로그 둘 다 생존(검증된 기존 가치), 매칭은 하나만 살아남는다.
    await expect(descEditor(panel)).toContainText("field missing");
    await expect(descEditor(panel)).toContainText("extra broke");
  });

  test("E2E-1b 파싱 후 삽입: 매칭 200(m*)을 지목하면 원문이 코드블럭으로 삽입된다", async () => {
    // m2 = /e2e-json(word tier, ident tier인 e2e-bigjson보다 후순위). 본문 마커 "note"는
    // /e2e-json에만 있어(직전 CAP 라운드가 삽입한 /e2e-bigjson엔 없음) 삽입 성공을 판정한다.
    mockDraft = { ...mockDraft, description: "MOCK INSERT RUN", logRefs: ["m2"] };
    await generate(panel, "응답 형태를 확인해 주세요");

    await expect(descEditor(panel)).toContainText("MOCK INSERT RUN");
    await expect(descEditor(panel)).toContainText("note"); // /e2e-json 원문 본문 삽입됨
    await expect(descEditor(panel)).toContainText("zqxbodyneedle");
  });
});
