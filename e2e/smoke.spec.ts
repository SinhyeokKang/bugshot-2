import { expect, pickElement, test, typeStyleValue } from "./fixtures/extension";

test("진입 → 선택 → 수정 → drafting 진입", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId("http://127.0.0.1/*");
  const panel = await ext.openPanel(tabId);

  // fresh 프로필은 연동 0개 → integrations 자동 전환 effect와 race — 클릭 후 active 단언을 폴링.
  await expect(async () => {
    await panel.getByTestId("tab-debug").click();
    await expect(panel.getByTestId("tab-debug")).toHaveAttribute(
      "data-state",
      "active",
    );
  }).toPass();

  await panel.getByTestId("mode-element").click();
  await pickElement(fixture, panel, "#title");
  await expect(panel.getByTestId("repick")).toBeVisible();

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
