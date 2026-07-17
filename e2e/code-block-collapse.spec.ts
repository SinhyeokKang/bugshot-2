import type { Locator, Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 16줄 넘는 코드블럭이 접혀 렌더되고 pill로 토글되는지. 접힘을 data-collapsed 속성으로
// 표현했기 때문에 판정 가능하다 — max-height·페이드·hover 페이드인은 시각이라 여기서 못 본다.
//
// 라벨은 ko/en 정규식으로 단언한다. 앱 locale은 워커 프로필에 따라 비결정적이라
// (GOTCHAS "locale 비결정") 한쪽 문구로 못 박으면 조용히 흔들린다. 정규식이면 "expand↔collapse가
// 실제로 바뀌었다"와 "{count}가 보간됐다"를 로케일 무관하게 잡는다.
const EXPAND_36 = /^(펼치기 \(36줄\)|Expand \(36 lines\))$/;
const COLLAPSE = /^(접기|Collapse)$/;

// 로그 행은 data-entry-id만 노출하고 URL은 텍스트로만 있다 — i18n이 아니라 데이터라 안전.
// "/e2e-json"은 "/e2e-bigjson"의 substring이 아니라 hasText로 서로 구분된다.
function logRow(scope: Page | Locator, path: string) {
  return scope.locator("[data-entry-id]").filter({ hasText: path });
}

async function seedNetworkLog(fixture: Page, panel: Page, path: string) {
  // 레코더 활성화 전 로그는 무시되므로 잡힐 때까지 발생+sync(1500ms) 대기를 반복한다.
  await expect(async () => {
    await fixture.evaluate((p) => fetch(`${p}?t=${performance.now()}`).catch(() => {}), path);
    await panel.waitForTimeout(1700);
    await expect(logRow(panel, path)).not.toHaveCount(0);
  }).toPass({ timeout: 30_000, intervals: [0] });
}

async function insertLog(panel: Page, path: string) {
  const dialog = panel.getByTestId("log-insert-dialog");
  await panel.getByTestId("section-log-insert-description").click();
  await expect(dialog).toBeVisible();
  await logRow(dialog, path).first().click();
  await expect(panel.getByTestId("log-insert-confirm")).toBeEnabled();
  await panel.getByTestId("log-insert-confirm").click();
  await expect(dialog).toBeHidden();
}

async function stubClipboard(panel: Page) {
  await panel.evaluate(() => {
    const w = window as unknown as { __copiedTexts: string[] };
    w.__copiedTexts = [];
    navigator.clipboard.write = async (items) => {
      for (const it of items) {
        const blob = await it.getType("text/plain");
        w.__copiedTexts.push(await blob.text());
      }
    };
    navigator.clipboard.writeText = async (t) => {
      w.__copiedTexts.push(t);
    };
  });
}

const copiedText = (panel: Page) =>
  panel.evaluate(() => (window as unknown as { __copiedTexts: string[] }).__copiedTexts.join("\n"));

test.describe.serial("code block collapse", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);

    await enterDebug(panel);
    await panel.getByTestId("subtab-network").click();
    await seedNetworkLog(fixture, panel, "/e2e-bigjson");
    await seedNetworkLog(fixture, panel, "/e2e-json");

    await panel.getByTestId("subtab-issue").click();
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  });

  // 탭 누수 방지 — worker fixture 공유라 안 닫으면 후행 spec의 fixtureTabId가 잔여 탭을 잡는다.
  test.afterAll(async () => {
    await panel?.close();
    await fixture?.close();
  });

  test("36줄 로그를 삽입하고 preview로 가면 코드블럭이 접힌 채 렌더된다", async () => {
    await insertLog(panel, "/e2e-bigjson");
    await panel.getByTestId("draft-title").fill("collapse e2e");
    await panel.getByTestId("to-preview").click();

    const section = panel.getByTestId("preview-section-description");
    await expect(section).toContainText("/e2e-bigjson");

    const wrapper = section.getByTestId("code-collapse");
    await expect(wrapper).toHaveAttribute("data-collapsible", "true");
    await expect(wrapper).toHaveAttribute("data-collapsed", "true");
    // 줄 수는 라벨이 아니라 data-lines로 — 라벨은 locale에 따라 변한다.
    await expect(section.getByTestId("code-collapse-toggle")).toHaveAttribute("data-lines", "36");
  });

  test("pill을 클릭하면 펼쳐지고 라벨·aria-expanded가 따라간다", async () => {
    const section = panel.getByTestId("preview-section-description");
    const wrapper = section.getByTestId("code-collapse");
    const toggle = section.getByTestId("code-collapse-toggle");

    await expect(toggle).toHaveText(EXPAND_36);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Playwright는 opacity:0을 visible로 쳐서 hover 없이도 클릭되지만, 실제 사용자 경로가
    // hover→클릭이므로 그대로 태운다.
    await wrapper.hover();
    await toggle.click();

    await expect(wrapper).toHaveAttribute("data-collapsed", "false");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText(COLLAPSE);
  });

  test("다시 클릭하면 접힌 상태로 되돌아온다", async () => {
    const section = panel.getByTestId("preview-section-description");
    const wrapper = section.getByTestId("code-collapse");
    const toggle = section.getByTestId("code-collapse-toggle");

    await wrapper.hover();
    await toggle.click();

    await expect(wrapper).toHaveAttribute("data-collapsed", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveText(EXPAND_36);
  });

  test("접힘/펼침 어느 상태로 복사해도 마크다운에 접기 흔적이 없다", async () => {
    const section = panel.getByTestId("preview-section-description");
    const wrapper = section.getByTestId("code-collapse");
    const toggle = section.getByTestId("code-collapse-toggle");

    await stubClipboard(panel);

    // 펼친 상태에서 한 번, 접은 상태에서 한 번 — 표시 상태가 본문에 새지 않는지.
    await toggle.click();
    await expect(wrapper).toHaveAttribute("data-collapsed", "false");
    await panel.getByTestId("copy-markdown").click();
    await toggle.click();
    await expect(wrapper).toHaveAttribute("data-collapsed", "true");
    await panel.getByTestId("copy-markdown").click();

    await expect.poll(() => copiedText(panel)).toContain("e2e-bigjson-000");
    const copied = await copiedText(panel);
    expect(copied).not.toContain("code-collapse");
    expect(copied).not.toContain("펼치기");
    expect(copied).not.toContain("Expand (");
    expect(copied).not.toContain("접기");
    expect(copied).not.toContain("Collapse");
  });

  test("15줄 이하 로그는 접히지 않고 pill이 안 보인다", async () => {
    await panel.getByTestId("back-to-draft").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();

    await insertLog(panel, "/e2e-json");
    await panel.getByTestId("to-preview").click();

    const section = panel.getByTestId("preview-section-description");
    await expect(section).toContainText("zqxbodyneedle");

    // 앞 테스트의 bigjson 블럭이 같은 섹션에 남아 있으므로 짧은 블럭 wrapper를 특정한다.
    const shortWrapper = section
      .getByTestId("code-collapse")
      .filter({ has: panel.locator("code", { hasText: "zqxbodyneedle" }) });
    await expect(shortWrapper).toHaveAttribute("data-collapsible", "false");
    // data-collapsible=false면 CSS가 pill을 display:none으로 끈다.
    await expect(shortWrapper.getByTestId("code-collapse-toggle")).toBeHidden();
  });
});

// 에디터(NodeView) 경로 — 브라우저가 mousedown에서 caret을 옮기므로 jsdom+user-event로는
// 재현이 안 된다(POSTMORTEM 2026-07-04과 같은 부류).
//
// 이 테스트가 실제로 무는 건 **toggle의 `contenteditable="false"`**다(design.md 위험 11).
// mutation으로 실측했다: 그 속성을 지우면 pill 클릭이 caret을 pill 텍스트 안으로 끌고 가
// anchor가 "cursor anchor paragraph"(offset 23) → "Collapse"(offset 0)로 바뀐다.
// 반대로 `stopEvent`를 통째로 `return false`로 만들어도 이 테스트는 green이다 — 즉 커서를
// 지키는 건 stopEvent가 아니다(design.md 위험 3의 근거와 어긋난다. 보고 참조).
test("에디터에서 pill을 클릭해도 본문 커서가 안 움직인다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("subtab-network").click();
  await seedNetworkLog(fixture, panel, "/e2e-bigjson");

  await panel.getByTestId("subtab-issue").click();
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();

  const section = panel.getByTestId("draft-section-description");
  // 커서 앵커로 쓸 문단을 코드블럭보다 먼저 넣는다.
  await section.locator('[contenteditable="true"]').fill("cursor anchor paragraph");
  await insertLog(panel, "/e2e-bigjson");

  const wrapper = section.getByTestId("code-collapse");
  await expect(wrapper).toHaveAttribute("data-collapsed", "true");

  // 문단 안에 커서를 놓고 위치를 기록한다.
  await section.locator("p", { hasText: "cursor anchor paragraph" }).click();
  const readSelection = () =>
    panel.evaluate(() => {
      const s = window.getSelection();
      return { text: s?.anchorNode?.textContent ?? null, offset: s?.anchorOffset ?? null };
    });
  const before = await readSelection();
  expect(before.text).toContain("cursor anchor paragraph");

  await wrapper.getByTestId("code-collapse-toggle").click();
  await expect(wrapper).toHaveAttribute("data-collapsed", "false");

  expect(await readSelection()).toEqual(before);

  await panel.close();
  await fixture.close();
});
