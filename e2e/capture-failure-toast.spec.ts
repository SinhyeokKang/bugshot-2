import {
  test,
  expect,
  enterDebug,
  pickElement,
  typeStyleValue,
  waitForPanelFront,
  waitForTargetFront,
} from "./fixtures/extension";

import { LOCALES } from "../src/i18n/locales";
import { issue } from "../src/i18n/namespaces/issue";

const INACTIVE_TEXTS = LOCALES.map((l) => issue[l]["issue.captureFailed.inactive"]);
const ELEMENT_MISSING_TEXTS = LOCALES.map((l) => issue[l]["issue.captureFailed.elementMissing"]);

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

// #264: 편집한 요소를 페이지에서 지우고 [다음]을 누르면 after 캡처의 prepare가 소실을 감지해
// selection을 해제하고(picker.selectionDetached), 같은 시각 [다음]은 drafting으로 확정한다. 둘이
// 겹치면 selection 없는 element drafting이 되어 패널이 헤더만 남기고 비었고, 그 상태가 세션에
// 저장돼 패널을 다시 열어도 같았다. 기대: element-missing 토스트 1회 + 캡처 진입 화면, reload 뒤에도.
test("편집한 요소를 지우고 [다음]을 누르면 element-missing 토스트 뒤 캡처 진입 화면이고 재오픈해도 같다", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId("http://127.0.0.1/basic.html");
  const panel = await ext.openPanel(tabId);

  try {
    await enterDebug(panel);
    await panel.getByTestId("mode-element").click();
    await pickElement(fixture, panel, "#title");
    await typeStyleValue(panel, "color", "#ff0000");
    await expect(fixture.locator("#title")).toHaveCSS("color", "rgb(255, 0, 0)");
    // 스타일 적용은 content에 120ms 재수집 타이머(picker.ts handleApplyStyles → scheduleSelectionUpdate)를
    // 남기고, 그 타이머도 소실을 감지한다. 지우기 전에 끝나지 않으면 styling 단계에서 해제가 먼저 일어나
    // next-step이 사라진다 — 이 spec이 재려는 건 [다음]의 after 캡처가 소실을 감지하는 경로다. 타이머 완료는
    // 패널·페이지 어디에도 관측 가능한 표지가 없어(ISOLATED world 내부) 상한 120ms에 여유를 둔 고정 대기로 둔다.
    await fixture.waitForTimeout(400);

    await fixture.evaluate(() => document.querySelector("#title")?.remove());

    const next = panel.getByTestId("next-step");
    await expect(next).not.toHaveAttribute("aria-disabled", "true");
    await next.click();
    await waitForPanelFront(panel);

    const toast = panel.locator('[data-sonner-toast][data-type="error"]');
    await expect(toast).toHaveCount(1, { timeout: 15_000 });
    const text = (await toast.textContent()) ?? "";
    expect(ELEMENT_MISSING_TEXTS.some((t) => text.includes(t)), text).toBe(true);

    // 판별 단언은 mode-element다 — 수정 전엔 빈 drafting이라 진입 화면이 없다. drafting-panel 0은
    // 수정 전에도 통과한다(DraftingPanel이 null을 그려 testid 자체가 없었다) — 보조 단언일 뿐이다.
    await expect(panel.getByTestId("mode-element")).toBeVisible();
    await expect(panel.getByTestId("drafting-panel")).toHaveCount(0);

    // 세션 저장(300ms 디바운스)이 끝난 뒤 다시 연다 — 저장된 상태가 빈 drafting이면 여기서 빈다.
    await panel.waitForTimeout(1000);
    await panel.reload();
    await enterDebug(panel);
    await expect(panel.getByTestId("mode-element")).toBeVisible();
    await expect(panel.getByTestId("drafting-panel")).toHaveCount(0);
  } finally {
    await panel.close();
    await fixture.close();
  }
});
