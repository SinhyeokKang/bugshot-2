import type { Page } from "@playwright/test";
import { enterDebug, expect, pickElement, test } from "./fixtures/extension";

// picker all_frames 지원 후에도 남는 거부 게이트 — 중첩(2-depth)·미주입(srcdoc류) iframe.
// sandbox iframe은 allow-scripts 유무와 무관하게 content script가 주입돼(ISOLATED world는
// 페이지 sandbox CSP 비적용 — probe 실측) 일반 1-depth처럼 선택 가능하다.
// 1-depth iframe 내부 선택(역전된 동작)은 picker-iframe.spec이 커버.
// unsupported URL(webstore) 경로는 실제 webstore 접근이 필요해 수동 잔여로 둔다.
test.describe.serial("picker-guard (중첩·미주입 iframe 거부)", () => {
  // 거부 dismiss의 fire-and-forget clearPicker가 다음 arm을 clobber하는 레이스는 부하 하에서만
  // 열려 간헐 실패한다(복구 루프로 흡수). one-shot 복구가 겹치면 30s 기본 타임아웃에 걸리므로
  // 복구 사이클을 여러 번 돌 여유를 준다.
  test.describe.configure({ timeout: 60_000 });

  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("iframe-nested.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await panel.close();
    await fixture.close();
  });

  const dialog = () => panel.getByTestId("iframe-unsupported-dialog");

  // 거부 픽은 repick이 안 떠 pickElement 재시도를 못 쓴다(GOTCHAS). 다이얼로그 노출까지
  // 클릭을 재시도해 arm 지연(핸드오프/announce 등록이 클릭보다 늦는 창)을 흡수한다.
  const tryReject = (selector: string, frame: string | undefined, budgetMs: number) =>
    expect(async () => {
      await pickElement(fixture, panel, selector, { expectSelection: false, frame });
      await expect(dialog()).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: budgetMs });

  // full-suite 부하에서 직전 거부의 fire-and-forget clearPicker가 새 arm을 clobber하면
  // panel=picking·content=idle로 멈춰 클릭 재시도로는 못 빠져나온다. picking을 취소해
  // idle로 되돌리고 mode-element로 새로 arm한 뒤 다시 시도한다. clobber가 연달아 나면
  // one-shot 복구로는 부족하므로 bounded 루프로 여러 번 복구한다(healthy 경로는 첫 시도에 리턴).
  async function pickUntilUnsupported(selector: string, frame?: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        await tryReject(selector, frame, 12000);
        return;
      } catch (err) {
        if (await dialog().isVisible().catch(() => false)) return; // 늦게 떴으면 성공
        if (attempt >= 3) throw err; // 복구 3회에도 안 뜨면 실제 실패
        if (await panel.getByTestId("picking-cancel").isVisible().catch(() => false)) {
          await panel.getByTestId("picking-cancel").click();
        }
        await expect(panel.getByTestId("mode-element")).toBeVisible();
        await panel.getByTestId("mode-element").click();
      }
    }
  }

  async function dismissAndExpectIdle() {
    await panel.getByTestId("iframe-unsupported-ok").click();
    await expect(dialog()).toBeHidden();
    // picker는 즉시 idle로 — 캡처 진입 화면(mode-element)이 다시 노출된다.
    await expect(panel.getByTestId("mode-element")).toBeVisible();
  }

  test("중첩(2-depth) iframe 클릭 → 미지원 안내 + idle 복귀", async () => {
    await enterDebug(panel);
    await panel.getByTestId("mode-element").click();

    // #outer(1-depth, 등록)는 핸드오프로 통과 → 1-depth picker가 #inner(2-depth,
    // 미등록 — announce는 부모==top 한정)를 거부해야 한다.
    await pickUntilUnsupported("#inner", "#outer");
    await dismissAndExpectIdle();
  });

  test("미주입(srcdoc) iframe 클릭 → 미지원 안내 + idle 복귀", async () => {
    await panel.getByTestId("mode-element").click();

    // srcdoc은 <all_urls> 미매치라 content script 미주입 → 미등록 —
    // top blocker가 유지돼 클릭이 iframe으로 통과하지 않고 거부 경로로 잡힌다.
    await pickUntilUnsupported("#inert");
    await dismissAndExpectIdle();
  });
});
