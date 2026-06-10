import { enterDebug, expect, pickElement, test } from "./fixtures/extension";

// picker는 top frame에만 주입(all_frames:false) — iframe 박스를 선택하면 미지원 안내 후 idle 복귀.
// unsupported URL(webstore) 경로는 실제 webstore 접근이 필요해 수동 잔여로 둔다.
test("iframe 박스 선택 → 미지원 안내 다이얼로그 + picker idle 복귀", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("iframe.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("mode-element").click();

  // iframe 박스 클릭 → top frame picker가 iframe 요소를 감지 → iframeUnsupported.
  await pickElement(fixture, panel, "#frame");

  const dialog = panel.getByTestId("iframe-unsupported-dialog");
  await expect(dialog).toBeVisible();

  await panel.getByTestId("iframe-unsupported-ok").click();
  await expect(dialog).toBeHidden();

  // picker는 즉시 idle로 — 캡처 진입 화면(mode-element)이 다시 노출된다.
  await expect(panel.getByTestId("mode-element")).toBeVisible();

  await panel.close();
  await fixture.close();
});
