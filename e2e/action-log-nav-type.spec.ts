import type { Locator, Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 액션 로그 navigation 항목의 유형 판별(back/forward/reload/traverse).
//
// 판정은 전부 `data-nav-type` **속성**으로 한다 — 앱 로케일이 비결정이라(GOTCHAS "locale 비결정")
// "뒤로가기"/"새로고침" 문구 단언은 제품이 정상이어도 flaky red가 된다.
//
// 액션 엔트리를 볼 수 있는 경로는 캡처 → `log-attachment-card` → `log-preview-dialog` →
// `log-preview-tab-action` 하나뿐이다(Debug 탭에 액션 서브탭이 없다 — action-log-scope 참조).
// 진입은 `mode-freeform` — `captureVisibleTab` cold-start·quota flake 이력을 피한다.
// 3탭 forceMount라 `:visible` 스코프가 필수다.

// 레코더 활성화를 콘솔 항목으로 프록시 폴링한다(action-log-scope의 seed 패턴). 콘솔·액션은
// 같은 레코더·같은 sync 주기라 콘솔이 흐르면 액션도 흐른다.
async function waitForRecorder(fixture: Page, panel: Page): Promise<void> {
  await panel.getByTestId("subtab-console").click();
  await expect(panel.getByTestId("subtab-console")).toHaveAttribute("data-state", "active");
  await expect(async () => {
    await fixture.evaluate(() => console.log("bugshot-e2e-navtype-armed", performance.now()));
    await panel.waitForTimeout(1700);
    await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });
  await panel.getByTestId("subtab-issue").click();
}

// 캡처를 마치고 액션 탭을 연다. 반환값은 그 탭 안의 엔트리 스코프.
async function openActionLog(panel: Page): Promise<Locator> {
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();

  const card = panel.getByTestId("log-attachment-card");
  await expect(card).toHaveCount(1);
  await card.click();

  const dialog = panel.getByTestId("log-preview-dialog");
  await expect(dialog).toBeVisible();
  await panel.getByTestId("log-preview-tab-action").click();
  return dialog.locator("[data-entry-id]:visible");
}

function navRows(entries: Locator, navType: string): Locator {
  return entries.and(entries.page().locator(`[data-nav-type="${navType}"]`));
}

test.describe.serial("action log navigation type", () => {
  // E1·E2 — SPA(같은 문서) traverse는 popstate 시점의 히스토리 인덱스 델타로 방향까지 잡는다.
  test("E1·E2 pushState 후 뒤로/앞으로가 back/forward로 기록된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("nav-history.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await waitForRecorder(fixture, panel);

    await fixture.bringToFront();
    await fixture.click("#push-a");
    await fixture.click("#push-b");
    await fixture.goBack();
    await fixture.goForward();
    await panel.bringToFront();
    await panel.waitForTimeout(1700);

    const entries = await openActionLog(panel);
    await expect(navRows(entries, "back")).not.toHaveCount(0);
    await expect(navRows(entries, "forward")).not.toHaveCount(0);

    await panel.close();
    await fixture.close();
  });

  // E6 — HashRouter 인덱스 드리프트 회귀 방지. <a href="#..."> 클릭은 popstate 없이 인덱스를
  // 올리므로, 갱신 지점을 열거하는 미러 변수 방식이면 여기서 방향 판정이 통째로 죽는다.
  test("E6 해시 라우팅(#/a → #/b) 뒤로가기도 back으로 기록된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("nav-history.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await waitForRecorder(fixture, panel);

    await fixture.bringToFront();
    await fixture.click("#hash-a");
    await fixture.click("#hash-b");
    await fixture.goBack();
    await panel.bringToFront();
    await panel.waitForTimeout(1700);

    const entries = await openActionLog(panel);
    await expect(navRows(entries, "back")).not.toHaveCount(0);

    await panel.close();
    await fixture.close();
  });

  // E5 — 해시 traverse는 popstate와 hashchange가 함께 발화해 항목이 2개 남는다(from/to가 달라
  // dedup을 통과). 이번 변경은 그중 popstate 유래에 방향을 붙일 뿐 **개수를 바꾸지 않는다**.
  // 페이지 진입 항목이 항상 하나 깔려 절대 개수로는 못 세므로 해시 URL로 좁힌 상대 카운트로 센다.
  test("E5 해시 뒤로가기의 항목 수가 기존과 같다 (보존)", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("nav-history.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await waitForRecorder(fixture, panel);

    await fixture.bringToFront();
    await fixture.click("#hash-x");
    await fixture.goBack();
    await panel.bringToFront();
    await panel.waitForTimeout(1700);

    const entries = await openActionLog(panel);
    // #x URL을 가리키는 항목은 popstate 유래 + hashchange 유래 2개다 — 프래그먼트 네비게이션은
    // 둘 다 발화하고 hashchange는 (oldURL, newURL)이 달라 dedup을 통과한다. 이번 변경은 그중
    // popstate 유래의 라벨만 건드리므로 **개수가 그대로여야 한다**(중복 정리는 비목표).
    await expect(entries.filter({ hasText: "#x" })).toHaveCount(2);
    // 그 popstate 유래 항목이 "앞으로가기"로 오라벨되면 안 된다 — 사용자는 링크를 클릭했다.
    await expect(navRows(entries, "forward")).toHaveCount(0);

    await panel.close();
    await fixture.close();
  });

  // E7 — 유령 진입 항목 회귀 방지. prepareRecorders는 activate 뒤에 clear를 보내고,
  // visibilitychange → inject가 **같은 문서를 재arm**한다. clear가 의도 없이 진입 항목 래치를
  // 내리면 여기서 일어나지도 않은 새로고침 항목이 하나 더 생긴다.
  // 절대 개수가 아니라 **복귀 전후 delta 0**으로 센다.
  test("E7 네비게이션 없이 탭 전환 후 복귀해도 navigation 항목이 늘지 않는다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("nav-history.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await waitForRecorder(fixture, panel);

    await openActionLog(panel);
    const navRowsAll = panel
      .getByTestId("log-preview-dialog")
      .locator('[data-entry-id][data-kind="navigation"]:visible');
    const navBefore = await navRowsAll.count();
    // 진입 항목이 최소 1개는 있어야 이 테스트가 의미를 갖는다(0이면 delta 0이 공허하게 통과).
    expect(navBefore).toBeGreaterThan(0);

    // 다른 탭으로 갔다가 돌아온다 — 네비게이션은 일어나지 않는다.
    const other = await ext.context.newPage();
    await other.goto(ext.fixtureUrl("second.html"));
    await other.bringToFront();
    await panel.waitForTimeout(500);
    await fixture.bringToFront();
    await panel.bringToFront();
    await panel.waitForTimeout(2500);

    expect(await navRowsAll.count()).toBe(navBefore);

    await other.close();
    await panel.close();
    await fixture.close();
  });

  // E4 — same-origin 멀티페이지 뒤로가기는 문서가 새로 로드된다. 도착 문서의 내비게이션 타이밍이
  // back_forward를 주지만 방향은 안 주므로 traverse(방향 미상)다. 로그는 same-origin이라 보존된다.
  test("E4 멀티페이지 뒤로가기가 traverse로 기록되고 이전 로그가 보존된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await waitForRecorder(fixture, panel);

    await fixture.goto(ext.fixtureUrl("second.html"));
    await fixture.goBack();
    await panel.waitForTimeout(2500);

    const entries = await openActionLog(panel);
    await expect(navRows(entries, "traverse")).not.toHaveCount(0);

    await panel.close();
    await fixture.close();
  });

  // E3 — 새로고침. 진입 항목은 pre-arm 버퍼를 타고 클리어 **이후에** 도착해야 보인다.
  // pre-arm이 죽으면(청크 강등) 이 항목이 조용히 사라진다.
  test("E3 새로고침이 reload로 기록된다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("nav-history.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await waitForRecorder(fixture, panel);

    await fixture.reload();
    await panel.waitForTimeout(2500);

    const entries = await openActionLog(panel);
    await expect(navRows(entries, "reload")).not.toHaveCount(0);

    await panel.close();
    await fixture.close();
  });
});
