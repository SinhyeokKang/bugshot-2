import { expect, test } from "./fixtures/extension";
import { openSettings } from "./fixtures/settings";

// 화면 언어 셀렉터 — 옵션 목록이 LOCALES 등록 순(ko·en·fr)으로 렌더되는지.
//
// 옵션 라벨 텍스트 단언의 정당성은 GOTCHAS "로케일 자체가 SUT" 항목을 따른다 — 라벨이
// 자기 언어 표기(endonym)라 현재 앱 로케일과 무관하게 같은 문자열이다. 반면 트리거
// (SelectValue)는 영속 로케일에 좌우돼 비결정이므로 단언하지 않는다(GOTCHAS "locale 비결정").
//
// 옵션은 열어서 읽기만 하고 **선택하지 않는다** — ext fixture가 { scope: "worker" } +
// workers: 1이라 한 샤드의 모든 spec이 하나의 프로필·chrome.storage를 공유한다. 골라버리면
// 후행 spec 전부가 그 로케일로 돈다(선택이 필요하면 issue-body-locale.spec처럼 복원까지).
const EXPECTED_OPTIONS = ["한국어", "English", "Français"];

test("화면 언어 셀렉터 — 옵션이 LOCALES 순서로 3개 렌더된다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);
  try {
    await openSettings(panel, "general");
    const trigger = panel.getByTestId("settings-locale");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(panel.getByRole("option")).toHaveText(EXPECTED_OPTIONS);
    await panel.keyboard.press("Escape"); // 선택 없이 닫는다 — 로케일 미오염
  } finally {
    await panel.close();
    await fixture.close();
  }
});
