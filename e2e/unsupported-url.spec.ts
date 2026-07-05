import { enterDebug, expect, test } from "./fixtures/extension";

// 미지원 URL 가드 — chrome:// 탭은 tab.url을 못 읽고(호스트 권한 밖) content script도 없어
// classifyTabSupport가 unsupported로 판정 → mode 진입 시 pickerUnavailable 다이얼로그.
test("chrome:// 탭에서 요소 선택 시도 → 미지원 안내 다이얼로그 → idle 복귀", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  await ext.fixtureTabId();
  const before = await ext.evalInExt(() =>
    chrome.tabs.query({}).then((tabs) => tabs.map((t) => t.id)),
  );

  const page = await ext.context.newPage();
  await page.goto("chrome://version");

  // chrome:// 탭은 url 패턴 쿼리가 안 되므로(호스트 권한 밖) 신규 탭 id를 diff로 찾는다.
  const tabId = await ext.evalInExt(
    (prev: (number | undefined)[]) =>
      chrome.tabs.query({}).then((tabs) => {
        const fresh = tabs.find((t) => t.id != null && !prev.includes(t.id));
        return fresh?.id ?? null;
      }),
    before,
  );
  expect(tabId).not.toBeNull();

  const panel = await ext.openPanel(tabId!);
  await enterDebug(panel);
  await panel.getByTestId("mode-element").click();

  await expect(panel.getByTestId("picker-unavailable-dialog")).toBeVisible();
  await panel.getByTestId("picker-unavailable-ok").click();
  await expect(panel.getByTestId("picker-unavailable-dialog")).toHaveCount(0);
  // picker 시작이 차단됐으니 진입 화면 그대로.
  await expect(panel.getByTestId("mode-element")).toBeVisible();

  await panel.close();
  await page.close();
  await fixture.close();
});
