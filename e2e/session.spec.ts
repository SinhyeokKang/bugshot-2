import {
  enterDebug,
  enterDebugAndPick,
  expect,
  test,
  typeStyleValue,
} from "./fixtures/extension";

// 세션 스코프/영속화 — style-changes-dialog.spec의 test14·16(reload 복원·cross-page 폐기)과
// 겹치지 않는 부분만: 패널 닫기→재열기 시 세션 폐기, 탭 간 세션 독립.

test("패널 닫기 후 재열기 → 세션 폐기로 초기 진입 화면 복귀", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();

  let panel = await ext.openPanel(tabId);
  await enterDebugAndPick(fixture, panel, "#title");
  await typeStyleValue(panel, "color", "#ff0000");
  await expect(panel.getByTestId("changes-trigger")).toBeEnabled();

  // 패널 닫기 → background port.onDisconnect가 세션 제거.
  await panel.close();

  // 재열기 → 복원할 세션 없음 → idle 진입 화면(mode-element).
  panel = await ext.openPanel(tabId);
  await enterDebug(panel);
  await expect(panel.getByTestId("mode-element")).toBeVisible();
  await expect(panel.getByTestId("repick")).toHaveCount(0);

  await panel.close();
  await fixture.close();
});

test("두 탭 독립 세션 — 한 탭의 수정이 다른 탭에 누출되지 않음", async ({
  ext,
}) => {
  const fa = await ext.context.newPage();
  await fa.goto(ext.fixtureUrl("basic.html"));
  const tabA = await ext.fixtureTabId("http://127.0.0.1/basic.html");
  const panelA = await ext.openPanel(tabA);
  await enterDebugAndPick(fa, panelA, "#title");
  await typeStyleValue(panelA, "color", "#ff0000");
  await expect(panelA.getByTestId("changes-trigger")).toBeEnabled();

  // 다른 탭(second.html) — 독립 세션이라 초기 진입 화면이어야 한다.
  const fb = await ext.context.newPage();
  await fb.goto(ext.fixtureUrl("second.html"));
  const tabB = await ext.fixtureTabId("http://127.0.0.1/second.html");
  const panelB = await ext.openPanel(tabB);
  await enterDebug(panelB);
  await expect(panelB.getByTestId("mode-element")).toBeVisible();
  await expect(panelB.getByTestId("changes-trigger")).toHaveCount(0);

  // 탭 A 세션은 그대로 보존.
  await panelA.bringToFront();
  await expect(panelA.getByTestId("changes-trigger")).toBeEnabled();

  await panelB.close();
  await panelA.close();
  await fb.close();
  await fa.close();
});
