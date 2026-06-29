import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 콘솔 로그 linkify — 자유 텍스트(args/stack) 안의 URL을 클릭 링크로 렌더한다.
// uncaught error 한 건으로 세 시나리오를 커버한다: 그 error는 (a) args에 `at <filename>:line:col`로
// page URL을, (b) cleanStack을 거친 stack에 page 프레임 URL을 담는다.
// 행 단위 a[href] 카운트는 펼친 행에 항상 있는 pageUrl 링크(:259) 때문에 linkify 회귀를 못 잡으므로
// 스택 검증은 data-testid="console-stack" 컨테이너로 스코프한다(tasks 설계).
// 시나리오 4(action navigation 행 action-nav-link 유지)는 replay-action-log.spec가 이미 커버 — 미중복.
test.describe.serial("console log linkify", () => {
  let fixture: Page;
  let panel: Page;
  let tabId: number;

  const errorRow = () =>
    panel
      .locator('[data-entry-id][data-level="error"]', { hasText: "E2E_STACK_ERR" })
      .first();

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("console-error.html"));
    tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
    await panel.getByTestId("subtab-console").click();

    // arm 대기 + uncaught error 캡처. 잡힐 때까지 재발화.
    // 정적 인라인 스크립트(console-error.html)의 함수가 throw → args에 `at <page URL>:line:col`,
    // stack에 page 프레임 URL이 담긴다(동적 주입 스크립트는 filename이 비어 URL이 안 들어감).
    await expect(async () => {
      await fixture.evaluate(() => (window as unknown as { __bugshotThrow: () => void }).__bugshotThrow());
      await panel.waitForTimeout(1700);
      await expect(errorRow()).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  // 시나리오 2 — 접힌 상태 클릭을 먼저 검증한다(펼침은 마지막 테스트에서).
  test("접힌 헤더 URL 링크 클릭은 행을 펼치지 않는다(stopPropagation)", async () => {
    await expect(panel.getByTestId("console-stack")).toHaveCount(0);

    // 헤더 링크는 target=_blank — 클릭 시 새 탭 네비게이션을 capture 단계 preventDefault로 억제한다.
    // React onClick(stopPropagation)은 bubble 단계라 그대로 실행되어 행 토글만 막힌다.
    await panel.evaluate(() => {
      document.addEventListener(
        "click",
        (e) => {
          const a = (e.target as HTMLElement)?.closest?.("a");
          if (a) e.preventDefault();
        },
        true,
      );
    });

    const link = errorRow().locator("a").first();
    await expect(link).toBeVisible();
    await link.click();

    // 토글 안 됨 — 펼침 영역(console-stack)이 출현하지 않는다.
    await expect(panel.getByTestId("console-stack")).toHaveCount(0);
  });

  // 시나리오 3 — 헤더 URL 링크가 포커스 가능한 native anchor(Tab/Enter 접근).
  test("헤더 URL 링크는 포커스 가능한 native anchor", async () => {
    const link = errorRow().locator("a").first();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("href", /^https?:\/\//);
    await link.focus();
    await expect(link).toBeFocused();
  });

  // 시나리오 1 — 펼치면 console-stack 안에 line:col 꼬리 없는 링크가 1개 이상.
  test("에러 행을 펼치면 스택 pre에 line:col 제거된 링크가 있다", async () => {
    // 헤더 클릭으로 펼침 — 링크(중앙 span)를 피해 우측 chevron 아이콘을 클릭(링크 아님, locale 무관).
    await errorRow().locator("svg.lucide-chevron-down").click();

    const stack = panel.getByTestId("console-stack").first();
    await expect(stack).toBeVisible();

    const links = stack.locator("a[href]");
    await expect(links.first()).toBeVisible();

    const hrefs = await links.evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    // href에서 끝의 :line(:col)이 제거됐다(표시 텍스트엔 유지되지만 href엔 없음).
    for (const h of hrefs) expect(h).not.toMatch(/:\d+(:\d+)?$/);
  });
});
