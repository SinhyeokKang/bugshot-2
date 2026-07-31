import type { Page } from "@playwright/test";
import {
  enterDebug,
  enterDebugAndPick,
  expect,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// 재현 환경 `API Hosts` 자동 행 — 캡처된 네트워크 로그에서 페이지와 같은 registrable domain의
// 다른 hostname을 파생해 draft.environment에 주입한다.
//
// 이 spec만 `*.bugshot.test`를 쓴다. 기존 cross-origin 수단(127.0.0.1 vs localhost)으로는
// 행이 아예 안 생긴다 — 둘은 registrable domain이 서로 달라 동족 조건을 못 만든다.
// launch args의 `--host-resolver-rules`가 서브도메인 전부를 fixture 서버로 보낸다.

declare global {
  interface Window {
    __fetchApis: (port: string) => Promise<boolean>;
  }
}

const PAGE_HOST = "app.bugshot.test";
// fixtureTabId 기본 패턴은 `http://127.0.0.1/*`이라 이 페이지를 못 잡는다 — 명시 필요.
const TAB_PATTERN = `http://${PAGE_HOST}/*`;

// 레코더의 fetch 후크는 `capturing`이 켜진 뒤 발생한 요청만 잡는다. arm 완료 신호가 없으므로
// 요청을 반복 발사하며 network 탭에 잡힐 때까지 기다린다(log-capture 관례).
async function seedApiRequests(fixture: Page, panel: Page, port: string): Promise<void> {
  await panel.getByTestId("subtab-network").click();
  await expect(async () => {
    await fixture.evaluate((p) => window.__fetchApis(p), port);
    await panel.waitForTimeout(1700);
    // 행은 pathname만 그린다(`networkLogPath`) — hostname은 화면에 없으므로 경로 마커로
    // 적재를 확인하고, hostname 판정 자체는 API Hosts 행 값이 담당한다.
    await expect(
      panel.locator("[data-entry-id]", { hasText: "/e2e-json-api-a" }),
    ).not.toHaveCount(0);
    await expect(
      panel.locator("[data-entry-id]", { hasText: "/e2e-json-auth" }),
    ).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });
}

// captureVisibleTab quota(~2회/초, 확장 전역)는 spec 경계를 넘는다 — 트리거를 drafting
// 진입까지 간격을 두고 재시도한다(capture.spec의 captureUntilDrafting과 동일 이유).
async function areaCaptureUntilDrafting(fixture: Page, panel: Page): Promise<void> {
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
}

const autoRow = (panel: Page) =>
  panel.locator('[data-testid="env-custom-row"][data-env-label="API Hosts"]');
const previewRow = (panel: Page) =>
  panel.locator('[data-testid="env-row"][data-env-label="API Hosts"]');

test.describe.serial("API Hosts 자동 행", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureHostUrl(PAGE_HOST, "api-hosts.html"));
    const tabId = await ext.fixtureTabId(TAB_PATTERN);
    panel = await ext.openPanel(tabId);
    await enterDebug(panel);
    await seedApiRequests(fixture, panel, new URL(ext.fixtureUrl("")).port);
  });

  test.afterAll(async () => {
    await panel?.close();
    await fixture?.close();
  });

  test("영역 캡처 → 재현 환경이 펼쳐진 채 API Hosts 행이 채워지고 본문에도 나간다", async () => {
    await areaCaptureUntilDrafting(fixture, panel);

    // 주입 시점에 섹션을 펼친다 — 사용자가 못 본 값은 고칠 수 없다는 게 이 행의 전제다.
    // 접힌 Section은 자식이 DOM에서 제거되므로 행 가시성이 곧 펼침 판정이다.
    await expect(autoRow(panel)).toHaveCount(1);
    await expect(autoRow(panel)).toBeVisible();
    // 요청 수 내림차순 — api 2건이 auth 1건보다 앞.
    await expect(autoRow(panel).locator("input").nth(1)).toHaveValue(
      "api.bugshot.test, auth.bugshot.test",
    );

    // 화면↔본문 비대칭이 이 기능의 유일한 하드 실패 이력이라 미리보기까지 태운다.
    await panel.getByTestId("draft-title").click();
    await panel.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(null))),
    );
    await panel.getByTestId("draft-title").fill("API hosts e2e");
    await panel.getByTestId("to-preview").click();

    await expect(previewRow(panel)).toHaveCount(1);
    await expect(previewRow(panel)).toContainText(
      "api.bugshot.test, auth.bugshot.test",
    );
  });

  test("행을 삭제하면 본문에서 빠지고, 로그 첨부를 다시 켜도 되살아나지 않는다", async () => {
    await panel.getByTestId("back-to-draft").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();

    await autoRow(panel).getByTestId("env-row-delete").click();
    await expect(autoRow(panel)).toHaveCount(0);

    // 로그 첨부 off→on은 자동 행을 재주입하는 경로지만, 명시 삭제 래치가 그보다 우선한다.
    const attach = panel.getByTestId("logs-attach-switch");
    await attach.click();
    await expect(attach).toHaveAttribute("data-state", "unchecked");
    await attach.click();
    await expect(attach).toHaveAttribute("data-state", "checked");
    await expect(autoRow(panel)).toHaveCount(0);

    await panel.getByTestId("to-preview").click();
    await expect(previewRow(panel)).toHaveCount(0);
  });
});

// 모드 게이트 — element는 로그를 안 싣는 것이 문서화된 약속이라 파생값도 나가면 안 된다.
// startPicking이 preserveLogs로 networkLog를 보존하므로, 게이트가 없으면 행이 샌다
// (reset()을 타는 경로는 networkLog가 null이라 게이트를 exercise하지 못한다).
test("element 모드는 로그가 보존돼 있어도 API Hosts 행을 만들지 않는다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureHostUrl(PAGE_HOST, "api-hosts.html"));
  const tabId = await ext.fixtureTabId(TAB_PATTERN);
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  // 픽 직전까지 동족 로그가 store에 있음을 단언한다 — 이게 없으면 뒤의 "행 없음"이 게이트
  // 덕인지 로그 부재 탓인지 갈리지 않아 검증이 공전한다.
  await seedApiRequests(fixture, panel, new URL(ext.fixtureUrl("")).port);
  await panel.getByTestId("subtab-issue").click();

  // logsAttach를 먼저 켜야 모드 게이트가 실제로 exercise된다 — 초기값이 false라 그냥
  // element로 들어가면 logsAttach 게이트가 먼저 잘라서, 모드 게이트를 지워도 행이 안 생긴다
  // (mutation으로 실측한 공허 케이스). 켜는 경로는 `logsAttach: true`를 세팅하는 모드 진입뿐이고,
  // 취소는 `cancelPicking`(preserveLogs)을 타야 한다 — `mode-screenshot`의 취소는
  // `cancelAreaCapture`→`reset()`이라 networkLog·logsAttach를 통째로 날려 다시 공전한다.
  await panel.getByTestId("mode-element-shot").click();
  await panel.getByTestId("picking-cancel").click();
  await expect(panel.getByTestId("mode-element")).toBeVisible();

  await enterDebugAndPick(fixture, panel, "#box");
  await typeStyleValue(panel, "color", "#ff0000");
  const next = panel.getByTestId("next-step");
  await expect(next).not.toHaveAttribute("aria-disabled", "true");
  await next.click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();

  // 재현 환경 섹션 자체는 뜨지만(readonly 행) 자동 행은 없어야 한다.
  await expect(panel.getByTestId("section-repro-env")).toBeVisible();
  await expect(autoRow(panel)).toHaveCount(0);

  await panel.close();
  await fixture.close();
});
