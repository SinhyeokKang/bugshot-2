import type { Page } from "@playwright/test";
import { enterDebug, expect, pickElement, test } from "./fixtures/extension";

// picker all_frames 지원 후에도 남는 거부 게이트 — 중첩(2-depth)·미주입(srcdoc류) iframe.
// sandbox iframe은 allow-scripts 유무와 무관하게 content script가 주입돼(ISOLATED world는
// 페이지 sandbox CSP 비적용 — probe 실측) 일반 1-depth처럼 선택 가능하다.
// 1-depth iframe 내부 선택(역전된 동작)은 picker-iframe.spec이 커버.
// unsupported URL(webstore) 경로는 실제 webstore 접근이 필요해 수동 잔여로 둔다.
test.describe.serial("picker-guard (중첩·미주입 iframe 거부)", () => {
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

  // 거부 픽은 repick이 안 떠 pickElement 재시도를 못 쓴다(GOTCHAS). 대신 다이얼로그
  // 노출까지 클릭을 재시도 — 핸드오프/announce 등록이 클릭보다 늦는 창(유실 클릭)을 흡수.
  async function pickUntilUnsupported(selector: string, frame?: string) {
    await expect(async () => {
      await pickElement(fixture, panel, selector, {
        expectSelection: false,
        frame,
      });
      await expect(dialog()).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
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
