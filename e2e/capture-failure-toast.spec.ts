import { test, expect, enterDebug } from "./fixtures/extension";

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
  // 미리 열면 그 탭이 앞으로 와 패널 클릭이 actionability에서 멈춘다(GOTCHAS 18) — 전환 시점에 연다.
  let third: Awaited<ReturnType<typeof ext.context.newPage>> | null = null;

  try {
    await enterDebug(panel);
    await panel.getByTestId("mode-screenshot").click();
    const fullPageBtn = panel.getByTestId("capture-method-fullpage");
    await expect(fullPageBtn).toBeVisible();
    await expect(fullPageBtn).not.toHaveAttribute("aria-disabled", "true");

    // 캡처를 시작시키는 데까지는 기존 하네스 우회(GOTCHAS 9): fixture를 앞에 두고 DOM 클릭.
    await fixture.bringToFront();
    await fullPageBtn.evaluate((el) => (el as HTMLElement).click());

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

    // 기존 복귀 동작(idle 리셋)은 그대로다.
    await panel.bringToFront();
    await expect(panel.getByTestId("mode-screenshot")).toBeVisible();
  } finally {
    await third?.close();
    await panel.close();
    await fixture.close();
  }
});
