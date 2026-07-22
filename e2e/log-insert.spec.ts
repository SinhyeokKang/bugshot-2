import { enterDebug, enterDebugAndPick, expect, test, typeStyleValue } from "./fixtures/extension";

// 로그 1건을 골라 이슈 본문에 코드블럭으로 삽입. tiptap 마크다운은 e2e가 직접 못 읽어
// (`.ProseMirror` 내부 상태) preview 렌더(`preview-section-*`)로 판정한다.
// 다이얼로그가 재사용하는 NetworkLogContent의 testid(network-search 등)는 라이브 서브탭과
// 겹치므로 전부 `log-insert-dialog` 스코프로 특정한다.
test.describe.serial("log insert", () => {
  test("네트워크 행 선택 → 삽입 → preview 본문에 요청이 코드블럭으로 나타난다", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-network").click();

    // 레코더 활성화 전 로그는 무시되므로 잡힐 때까지 발생+sync 대기를 반복 (log-capture 관례).
    await expect(async () => {
      await fixture.evaluate(() => fetch("/e2e-json?insert=" + performance.now()).catch(() => {}));
      await panel.waitForTimeout(1700);
      await expect(panel.locator("[data-entry-id]")).not.toHaveCount(0);
    }).toPass({ timeout: 30_000, intervals: [0] });

    // 캡처 모드 버튼은 issue 서브탭에 있다 — network 서브탭에서 로그를 확인했으니 되돌아온다.
    await panel.getByTestId("subtab-issue").click();
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();

    const dialog = panel.getByTestId("log-insert-dialog");
    await panel.getByTestId("section-log-insert-description").click();
    await expect(dialog).toBeVisible();

    // 기본 활성 탭은 console-first지만 이 spec은 network만 시드(console 비어 있음)라 network가 열린다.
    // 행을 고르면 삽입 버튼이 활성화된다.
    await expect(panel.getByTestId("log-insert-confirm")).toBeDisabled();
    await dialog.locator("[data-entry-id]").first().click();
    await expect(panel.getByTestId("log-insert-confirm")).toBeEnabled();

    await panel.getByTestId("log-insert-confirm").click();
    await expect(dialog).toBeHidden();

    await panel.getByTestId("draft-title").fill("log insert e2e");
    await panel.getByTestId("to-preview").click();
    // 헤더 라인 `GET /e2e-json → 200 OK` 형태 — path는 networkLogPath(pathname)라 쿼리가 없다.
    await expect(panel.getByTestId("preview-section-description")).toContainText("/e2e-json");
    await expect(panel.getByTestId("preview-section-description")).toContainText("GET");

    await panel.close();
    await fixture.close();
  });

  test("로그를 안 싣는 element 모드에선 삽입 버튼이 비활성", async ({ ext }) => {
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    const panel = await ext.openPanel(tabId);

    // element는 supportsConsoleNetworkLog=false — 패널이 열려 있어 로그가 캡처돼 있어도
    // 첨부·AI와 같은 게이트라 본문 삽입 대상이 아니다(action-log-scope의 카드 부재와 같은 계열).
    await enterDebugAndPick(fixture, panel, "#title");
    await typeStyleValue(panel, "color", "#ff0000");

    const next = panel.getByTestId("next-step");
    await expect(next).not.toHaveAttribute("aria-disabled", "true");
    await next.click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();

    // TooltipIconButton은 disabled가 아니라 aria-disabled로 잠근다(툴팁 유지).
    await expect(panel.getByTestId("section-log-insert-description")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // force click — 잠긴 버튼을 실제로 눌러도 다이얼로그가 안 열려야 가드가 증명된다
    // (TooltipIconButton이 onClick을 자체 차단. capture-modes-layout의 비활성 버튼 선례).
    await panel.getByTestId("section-log-insert-description").click({ force: true });
    await expect(panel.getByTestId("log-insert-dialog")).toHaveCount(0);

    await panel.close();
    await fixture.close();
  });
});
