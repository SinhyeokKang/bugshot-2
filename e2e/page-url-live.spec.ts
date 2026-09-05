import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 재현 환경 `Page` 행의 추적/동결 축.
//
// freeform 드래프팅 중 대상 탭이 이동하면 Page가 현재 페이지를 따라가고, 캡처 모드는 찍은
// 페이지로 동결된 채 남는다. **이 축은 e2e가 유일한 그물이다** — 크롬이 실제로
// `tabs.onUpdated`를 쏘고 `tabs.get`이 새 URL을 돌려주는 구간이라 jsdom으로 재현할 수 없다.
// 유닛·jsdom은 리졸버·store·발행 훅·배선까지만 덮는다.
//
// 이동은 같은 fixture 서버 안에서만 한다 — cross-origin으로 가면 세션 만료·activeTab 회수
// 축이 섞여 판정이 흐려진다. 모드별 세션은 `editor:${tabId}` 스코프라 두 시나리오를 탭으로
// 가른다(freeform drafting을 벗어나는 유일한 경로가 취소 다이얼로그인데 testid가 없다).

const draftPageValue = (panel: Page) =>
  panel.locator('[data-testid="env-readonly-row"][data-env-label="Page"] input').nth(1);

const previewPageRow = (panel: Page) =>
  panel.locator('[data-testid="env-row"][data-env-label="Page"]');

// 재현 환경 섹션은 기본 접힘이고, 접히면 자식이 DOM에서 빠진다.
async function openEnvSection(panel: Page): Promise<void> {
  if ((await draftPageValue(panel).count()) === 0) {
    await panel.getByTestId("section-repro-env-toggle").click();
  }
  await expect(draftPageValue(panel)).toBeVisible();
}

test.describe.serial("재현 환경 Page 행 — freeform 추적", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
  });

  test.afterAll(async () => {
    await panel?.close();
    await fixture?.close();
  });

  test("탭이 이동하면 Page가 따라간다", async ({ ext }) => {
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await openEnvSection(panel);
    await expect(draftPageValue(panel)).toHaveValue(/basic\.html$/);

    await fixture.goto(ext.fixtureUrl("second.html"));

    // onUpdated → tabs.get → store 발행까지 비동기. 고정 sleep 대신 값으로 기다린다.
    await expect(draftPageValue(panel)).toHaveValue(/second\.html$/, { timeout: 10_000 });
  });

  // 화면과 제출 본문이 같은 값을 써야 한다 — 이 픽스의 첫 판본이 화면만 고치고 복사 본문
  // 경로를 빠뜨렸는데 유닛은 전부 green이었다.
  test("미리보기 표도 같은 값을 쓴다", async () => {
    // [다음]은 제목이 비면 native disabled라 클릭이 막힌다.
    await panel.getByTestId("draft-title").fill("page url live e2e");
    await panel.getByTestId("to-preview").click();
    await expect(previewPageRow(panel)).toContainText("second.html");
  });
});

// 대조군. 이게 없으면 "그냥 항상 따라간다"와 구분되지 않는다 — 스크린샷은 찍은 페이지의
// 산출물이라 Page가 움직이면 이미지와 값이 어긋난다.
test("screenshot은 캡처한 페이지로 동결된다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  try {
    await enterDebug(panel);

    // captureVisibleTab quota(~2회/초, 확장 전역)는 spec 경계를 넘는다 — 간격을 두고 재시도.
    const drafting = panel.getByTestId("drafting-panel");
    await expect(async () => {
      if (!(await drafting.isVisible())) {
        await panel.getByTestId("subtab-issue").click();
        await panel.getByTestId("mode-screenshot").click();
        await fixture.bringToFront();
        await fixture.mouse.move(40, 40);
        await fixture.mouse.down();
        await fixture.mouse.move(300, 220, { steps: 10 });
        await fixture.mouse.up();
      }
      await expect(drafting).toBeVisible({ timeout: 2500 });
    }).toPass({ intervals: [1000, 1500, 2000, 2500], timeout: 25_000 });

    await openEnvSection(panel);
    await expect(draftPageValue(panel)).toHaveValue(/basic\.html$/);

    await fixture.goto(ext.fixtureUrl("second.html"));
    await fixture.waitForURL(/second\.html$/);

    // 음성 단언이라 "아직 안 바뀐 것"과 "안 바뀌는 것"을 구분해야 한다. store를 직접
    // 들여다보려면 프로덕션에 probe를 심어야 해서(이 스킬의 src 수정 범위 밖) 대신
    // 경계 있는 대기로 가른다 — 같은 파일의 추적 케이스가 발행 파이프라인이 살아 있음을
    // 보장하고, 실측 반영은 1s 내외다. 4s는 그 여유의 4배다.
    await panel.waitForTimeout(4000);
    await expect(draftPageValue(panel)).toHaveValue(/basic\.html$/);

  } finally {
    await panel.close();
    await fixture.close();
  }
});
