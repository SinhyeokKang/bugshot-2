import { test, expect, enterDebug, waitForTargetFront } from "./fixtures/extension";

import { LOCALES } from "../src/i18n/locales";
import { issue } from "../src/i18n/namespaces/issue";

const INACTIVE_TEXTS = LOCALES.map((l) => issue[l]["issue.captureFailed.inactive"]);

// 캡처 실패는 예전엔 무음 idle 리셋이었다. 페이지 캡처는 타일마다 tab.active를 다시 확인하므로
// 진행 도중 대상 탭이 가려지면 inactive로 끊기고, 그 이유가 토스트로 보여야 한다.
test("페이지 캡처 도중 대상 탭이 가려지면 inactive 토스트가 뜨고 idle로 돌아온다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("scroll-capture-long.html"));
  const tabId = await ext.fixtureTabId("http://127.0.0.1/scroll-capture-long.html");
  const panel = await ext.openPanel(tabId);
  // 미리 열면 그 탭이 앞으로 와 패널 클릭이 actionability에서 멈춘다 — 전환 시점에 연다.
  let third: Awaited<ReturnType<typeof ext.context.newPage>> | null = null;

  try {
    await enterDebug(panel);
    await panel.getByTestId("mode-screenshot").click();
    const fullPageBtn = panel.getByTestId("capture-method-fullpage");
    await expect(fullPageBtn).toBeVisible();
    await expect(fullPageBtn).not.toHaveAttribute("aria-disabled", "true");

    // 패널 버튼만 누른다 — 패널이 캡처 동안 fixture를 앞으로 가져온다(탭 모드 hold).
    await fullPageBtn.click();

    // 첫 타일이 스티치된 뒤(onProgress) 제3 탭으로 가린다 — 이후 타일의 active 재확인이 끊는다.
    const progress = panel.getByRole("progressbar");
    await expect
      .poll(async () => Number((await progress.getAttribute("aria-valuenow")) ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    third = await ext.context.newPage();
    await third.bringToFront();

    const toast = panel.locator('[data-sonner-toast][data-type="error"]');
    await expect(toast).toHaveCount(1, { timeout: 15_000 });
    const text = (await toast.textContent()) ?? "";
    expect(INACTIVE_TEXTS.some((t) => text.includes(t)), text).toBe(true);

    // 기존 복귀 동작(idle 리셋)은 그대로다. 제3 탭으로 간 사용자의 포커스는 빼앗지 않으므로
    // (대상이 더는 활성이 아니라 복원 안 함) 직접 패널로 돌아간다.
    await panel.bringToFront();
    await expect(panel.getByTestId("mode-screenshot")).toBeVisible();
  } finally {
    await third?.close();
    await panel.close();
    await fixture.close();
  }
});

// 탭 모드 전체 페이지 캡처의 취소 = 패널 탭으로 돌아가기(orch D7). 캡처 내내 대상이 앞이라 패널의
// 취소 버튼은 가려져 있다 — 패널로 오면 다음 타일에서 끊기고 inactive 토스트 1회 + idle 복귀이며,
// 대상을 다시 앞으로 끌고 가지 않는다(복원·활성화는 hold 첫 진입에서만).
test("탭 모드 페이지 캡처 도중 패널 탭으로 돌아가면 취소되고 대상으로 끌려가지 않는다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("scroll-capture-long.html"));
  const tabId = await ext.fixtureTabId("http://127.0.0.1/scroll-capture-long.html");
  const panel = await ext.openPanel(tabId);

  try {
    await enterDebug(panel);
    await panel.getByTestId("mode-screenshot").click();
    const fullPageBtn = panel.getByTestId("capture-method-fullpage");
    await expect(fullPageBtn).not.toHaveAttribute("aria-disabled", "true");
    await fullPageBtn.click();
    await waitForTargetFront(panel);

    const progress = panel.getByRole("progressbar");
    await expect
      .poll(async () => Number((await progress.getAttribute("aria-valuenow")) ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    await panel.bringToFront();

    const toast = panel.locator('[data-sonner-toast][data-type="error"]');
    await expect(toast).toHaveCount(1, { timeout: 15_000 });
    const text = (await toast.textContent()) ?? "";
    expect(INACTIVE_TEXTS.some((t) => text.includes(t)), text).toBe(true);
    await expect(panel.getByTestId("mode-screenshot")).toBeVisible();

    const fixtureActive = () =>
      ext.evalInExt((id: number) => chrome.tabs.get(id).then((t) => t.active), tabId);
    await panel.waitForTimeout(1500);
    expect(await fixtureActive()).toBe(false);
    await expect(toast).toHaveCount(1);
  } finally {
    await panel.close();
    await fixture.close();
  }
});
