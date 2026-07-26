import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";
import type { ExtContext } from "./fixtures/extension";

// 미지원 URL에서 패널이 그리는 것 — 캡처 버튼 대신 안내, 로그 서브탭 잠금, 동작하는 것만 남김.
// chrome:// 탭은 tab.url을 못 읽어(호스트 권한 밖) 빈 URL로 오고, useTabUnsupported가 그걸
// 미지원으로 판정한다. 이 spec은 ext.openPanel을 쓰므로 activateTab의 가드 삭제 자체는
// 커버하지 않는다(단위 테스트 + 수동 검증 담당) — 패널 내부 렌더만 검증한다.

const CAPTURE_BUTTONS = [
  "mode-element",
  "mode-element-shot",
  "mode-screenshot",
  "mode-record",
  "replay-button",
] as const;

/** chrome:// 탭은 url 패턴 쿼리가 안 되므로(호스트 권한 밖) 신규 탭 id를 diff로 찾는다. */
async function openUnsupportedTab(ext: ExtContext): Promise<{ page: Page; tabId: number }> {
  const before = await ext.evalInExt(() =>
    chrome.tabs.query({}).then((tabs) => tabs.map((t) => t.id)),
  );

  const page = await ext.context.newPage();
  await page.goto("chrome://version");

  const tabId = await ext.evalInExt(
    (prev: (number | undefined)[]) =>
      chrome.tabs.query({}).then((tabs) => {
        const fresh = tabs.find((t) => t.id != null && !prev.includes(t.id));
        return fresh?.id ?? null;
      }),
    before,
  );
  expect(tabId).not.toBeNull();
  return { page, tabId: tabId! };
}

test("chrome:// 탭에서 패널을 열면 캡처 대신 미지원 안내가 보이고, 동작하는 것만 남는다", async ({
  ext,
}) => {
  // fixture 탭을 하나 띄워 확장·서버를 예열한다(다른 spec과 동일한 전제).
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  await ext.fixtureTabId();

  const { page, tabId } = await openUnsupportedTab(ext);
  const panel = await ext.openPanel(tabId);
  await enterDebug(panel);

  // 판정이 chrome.tabs.get 왕복을 거치므로 안내가 나타날 때까지 기다린다
  // (판정 중은 기존 UI를 그린다 — 캡처 버튼이 몇 프레임 보일 수 있다).
  await expect(panel.getByTestId("capture-unsupported")).toBeVisible();

  for (const id of CAPTURE_BUTTONS) {
    await expect(panel.getByTestId(id)).toHaveCount(0);
  }
  // [이슈 작성]은 aria-disabled가 아니라 렌더 제외다.
  await expect(panel.getByTestId("mode-freeform")).toHaveCount(0);

  // 로그가 쌓이지 않으므로 console/network 서브탭은 잠긴다.
  await expect(panel.getByTestId("subtab-console")).toBeDisabled();
  await expect(panel.getByTestId("subtab-network")).toBeDisabled();

  // 페이지와 무관하게 동작하는 것은 남는다 — 미지원 화면이 막다른 길이 되지 않게.
  await expect(panel.getByTestId("open-guide")).toBeVisible();
  await expect(panel.getByTestId("integrations-cta")).toBeVisible();

  await panel.close();
  await page.close();
  await fixture.close();
});

// 이 spec의 핵심 단언 — "새로고침 버튼 불필요"(design.md 대안 H 기각)의 근거다.
test("미지원 탭을 지원 페이지로 이동시키면 조작 없이 캡처 진입 화면으로 복구된다", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  await ext.fixtureTabId();

  const { page, tabId } = await openUnsupportedTab(ext);
  const panel = await ext.openPanel(tabId);
  await enterDebug(panel);
  await expect(panel.getByTestId("capture-unsupported")).toBeVisible();

  // 같은 탭을 지원 URL로 이동 — 패널에는 손대지 않는다.
  await page.goto(ext.fixtureUrl("basic.html"));

  await expect(panel.getByTestId("mode-element")).toBeVisible();
  await expect(panel.getByTestId("capture-unsupported")).toHaveCount(0);
  await expect(panel.getByTestId("mode-freeform")).toBeVisible();
  await expect(panel.getByTestId("subtab-console")).toBeEnabled();

  await panel.close();
  await page.close();
  await fixture.close();
});
