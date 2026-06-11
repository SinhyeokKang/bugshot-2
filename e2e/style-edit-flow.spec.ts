import { enterDebugAndPick, expect, test, typeStyleValue } from "./fixtures/extension";

// 요소 스타일 편집의 메인 동선: 선택 → 스타일 수정 → [다음] → drafting 진입.
// next-step(SelectedPanel 전용)을 거쳐 drafting으로 넘어가는 경로의 유일한 커버.
test("요소 선택 → 스타일 수정 → [다음] → drafting 진입", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebugAndPick(fixture, panel, "#title");

  await typeStyleValue(panel, "color", "#ff0000");
  await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(255, 0, 0)");

  const next = panel.getByTestId("next-step");
  // [다음]은 disabled가 아닌 aria-disabled+가드 패턴 — 클릭 전 단언 없으면 조용한 no-op.
  await expect(next).not.toHaveAttribute("aria-disabled", "true");
  await next.click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();

  // worker fixture(persistent context)를 다음 spec과 공유 — 탭을 남기면
  // 후행 spec의 fixtureTabId가 이 탭(drafting 세션)을 잡는다.
  await panel.close();
  await fixture.close();
});
