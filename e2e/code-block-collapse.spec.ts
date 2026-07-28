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

  // 행 번호 열의 정확성은 전부 **렌더 기하**에 걸려 있다 — 폭은 자릿수를 1ch로 환산해 나오고,
  // 정렬은 gutter 패딩과 pre 패딩의 짝에서 나오며, 스크롤 제외는 absolute 배치에서 나온다.
  // jsdom엔 layout이 없어 이 축들은 원리적으로 단위 테스트로 못 본다(CSS 선언 문자열 대조가
  // 잡는 건 "값이 그대로인가"지 "그 값이 실제로 맞는가"가 아니다). 여기서만 갈린다.
  test("행 번호가 코드와 안 겹치고 첫 줄이 정렬된다", async () => {
    const section = panel.getByTestId("preview-section-description");
    const wrapper = section
      .getByTestId("code-collapse")
      .filter({ has: panel.locator("code", { hasText: "e2e-bigjson-000" }) });

    const gutter = wrapper.getByTestId("code-collapse-gutter");
    const box = await gutter.boundingBox();
    const codeBox = await wrapper.locator("code").boundingBox();
    expect(box).not.toBeNull();
    expect(codeBox).not.toBeNull();

    // 번호 열 오른쪽 끝이 코드 첫 글자보다 앞 — ch 환산이 어긋나면 코드가 번호 위로 올라온다.
    expect(box!.x + box!.width).toBeLessThanOrEqual(codeBox!.x);

    // 첫 번호와 코드 첫 줄의 세로 중심이 맞물리는지. 블록(span)과 인라인(code)은 라인박스
    // 기준점이 달라 top끼리 비교하면 half-leading만큼 상시 어긋나므로 중심으로 본다.
    // 패딩 짝(16px)이 깨지면 한 줄 높이(18px) 이상 벌어져 확실히 갈린다.
    const firstNo = gutter.locator("span").first();
    await expect(firstNo).toHaveText("1");
    const noBox = await firstNo.boundingBox();
    const firstLine = await wrapper.locator("code").evaluate((el) => {
      const range = document.createRange();
      range.setStart(el, 0);
      range.setEnd(el, 1);
      const r = range.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    const noCenter = noBox!.y + noBox!.height / 2;
    const lineCenter = firstLine.top + firstLine.height / 2;
    expect(Math.abs(noCenter - lineCenter)).toBeLessThanOrEqual(3);
  });

  test("가로 스크롤을 해도 행 번호는 제자리에 남고 코드에 가려지지 않는다", async () => {
    const section = panel.getByTestId("preview-section-description");
    const wrapper = section
      .getByTestId("code-collapse")
      .filter({ has: panel.locator("code", { hasText: "e2e-bigjson-000" }) });
    const gutter = wrapper.getByTestId("code-collapse-gutter");
    const pre = wrapper.locator("pre");

    // 이 픽스처는 긴 문자열 배열이라 실제로 가로 오버플로가 난다 — 전제가 깨지면 이 테스트가
    // 아무것도 안 보게 되므로 먼저 단언한다.
    const overflow = await pre.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeGreaterThan(0);

    const before = await gutter.boundingBox();
    await pre.evaluate((el) => {
      el.scrollLeft = 9999;
    });
    await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const after = await gutter.boundingBox();

    // 스크롤 컨테이너가 pre 하나뿐이라 번호 열은 화면상 제자리에 남는다.
    expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);

    // pre의 padding-left는 스크롤 영역의 일부라, 밀려온 코드는 번호 자리까지 들어온다.
    // 그걸 가리는 건 gutter의 불투명 배경뿐이다 — 투명해지면 글자가 겹쳐 찍힌다.
    const alpha = await gutter.evaluate((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (!m) return 0;
      const parts = m[1].split(",").map((p) => Number(p.trim()));
      return parts.length > 3 ? parts[3] : 1;
    });
    expect(alpha).toBe(1);
  });

  test("접힌 블럭은 보이는 줄까지만 번호를 그린다", async () => {
    const section = panel.getByTestId("preview-section-description");
    const wrapper = section
      .getByTestId("code-collapse")
      .filter({ has: panel.locator("code", { hasText: "e2e-bigjson-000" }) });

    await expect(wrapper).toHaveAttribute("data-collapsed", "true");
    const collapsed = await wrapper.getByTestId("code-collapse-gutter").locator("span").count();
    expect(collapsed).toBeLessThanOrEqual(16);

    // 펼치면 전체 줄 수(36)를 채운다 — 상한만 재면 "번호가 아예 안 뜨는" 회귀를 놓친다.
    await wrapper.hover();
    await wrapper.getByTestId("code-collapse-toggle").click();
    await expect(wrapper).toHaveAttribute("data-collapsed", "false");
    await expect(wrapper.getByTestId("code-collapse-gutter").locator("span")).toHaveCount(36);
  });
});

// 접힌 블럭은 readonly다 — 안 보이는 줄에 글자가 들어가면 안 된다.
//
// **클릭으로는 이걸 못 잡는다**: 접힌 블럭 클릭은 우리 핸들러가 먼저 펼쳐버려서, caret이
// 들어와도 이미 편집 가능 상태라 가드 유무가 결과에 안 나타난다(그렇게 쓴 첫 판은 공허했다).
// 방향키는 우리 핸들러를 안 거치고 PM/브라우저가 직접 caret을 옮기는 유일한 경로라 갈린다.
// mutation 실측: 셸의 `contenteditable="false"`를 빼면 anchor가 코드 안(" OK\n--- response -")으로
// 들어가고 타이핑이 접힌 줄에 유입된다(true). 있으면 anchor "" · 유입 false.
test("접힌 블럭에 방향키로 들어가 타이핑해도 글자가 안 들어간다", async ({ ext }) => {
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
  // 코드블럭 위에 문단을 둬 방향키 출발점을 만든다.
  await section.locator('[contenteditable="true"]').first().fill("cursor anchor paragraph");
  await insertLog(panel, "/e2e-bigjson");

  const wrapper = section.getByTestId("code-collapse");
  await expect(wrapper).toHaveAttribute("data-collapsed", "true");

  await section.locator("p", { hasText: "cursor anchor paragraph" }).click();
  await panel.keyboard.press("End");
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.press("ArrowDown");
  await panel.keyboard.type("QQQ");

  // 접힌 채로 남아야 하고, 코드 본문에 글자가 새면 안 된다.
  await expect(wrapper).toHaveAttribute("data-collapsed", "true");
  expect(
    await panel.evaluate(
      () =>
        document
          .querySelector('[data-testid="code-collapse"] code')
          ?.textContent?.includes("QQQ") ?? false,
    ),
  ).toBe(false);

  await panel.close();
  await fixture.close();
});

// 접힘은 항상 "로그 최상단"이어야 한다. 펼쳐서 아래쪽에 caret을 두고 접으면, 브라우저가 그
// caret을 보이게 pre를 스크롤해둔 상태가 남아 로그 중간이 보인 채 접힌다(실사용 제보).
// DOM selection만 지우는 걸론 못 막는다 — PM이 state.selection에서 되돌려놓고 다시 스크롤한다.
test("caret을 아래쪽에 둔 채 접어도 로그 최상단이 보인다", async ({ ext }) => {
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
  await insertLog(panel, "/e2e-bigjson");

  const wrapper = section.getByTestId("code-collapse");
  // 접힌 블럭 클릭 = 펼침. 한 번 더 클릭해야 caret이 들어간다(펼친 뒤엔 편집 대상).
  await wrapper.locator("code").click();
  await wrapper.locator("code").click();
  for (let i = 0; i < 30; i++) await panel.keyboard.press("ArrowDown");

  await wrapper.getByTestId("code-collapse-toggle").click();
  await expect(wrapper).toHaveAttribute("data-collapsed", "true");

  expect(await panel.evaluate(() => document.querySelector("[data-testid='code-collapse'] pre")!.scrollTop)).toBe(0);

  await panel.close();
  await fixture.close();
});

// 편집 중 타이핑으로 임계값(15줄)을 넘는 순간, 접는 대신 펼쳐야 한다(read/edit 모델).
// 그대로 접으면 caret이 잘린 영역에 갇히고 keymap 키가 안 보이는 줄을 편집한다(POSTMORTEM 2026-07-18:
// readonly 진입로가 pill 클릭 말고 update()에도 있는데 보정이 pill 쪽에만 있었다).
//
// 이건 삽입(constructor)이 아니라 **이미 있는 짧은 블럭을 타이핑으로 키워 넘기는** update() 경로
// 전용이다. mutation 실측: update()의 setExpanded(true) 승격을 빼면 16줄째에 data-collapsed=true로
// 접히고(red), contenteditable=false라 이후 타이핑도 코드에 안 들어간다(ZZZ 부재 → red).
test("편집 중 타이핑으로 임계값을 넘기면 접지 않고 펼친 채 편집이 이어진다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("subtab-network").click();
  await seedNetworkLog(fixture, panel, "/e2e-json");

  await panel.getByTestId("subtab-issue").click();
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();

  const section = panel.getByTestId("draft-section-description");
  await insertLog(panel, "/e2e-json");

  const wrapper = section.getByTestId("code-collapse");
  const toggle = wrapper.getByTestId("code-collapse-toggle");
  // 5줄이라 접힘 대상이 아니다 — 출발 상태 확인.
  await expect(wrapper).toHaveAttribute("data-collapsible", "false");

  // caret을 코드 **시작**에 두고 위에서부터 줄을 쌓는다 — triple-click으로 textblock을 잡고
  // ArrowLeft로 시작에 collapse. (코드 끝에서 Enter는 블럭을 빠져나가 문단에 입력된다 — 끝에
  // 안 닿게 위에서 쌓으면 caret이 계속 블럭 안이라 전이 시점 selectionInside=true.)
  await wrapper.locator("code").click({ clickCount: 3 });
  await panel.keyboard.press("ArrowLeft");
  for (let i = 0; i < 15; i++) {
    await panel.keyboard.type("x");
    await panel.keyboard.press("Enter");
  }

  // 임계값을 넘겼는데도 접히지 않고 펼친 채 남는다.
  await expect(wrapper).toHaveAttribute("data-collapsible", "true");
  await expect(wrapper).toHaveAttribute("data-collapsed", "false");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(Number(await toggle.getAttribute("data-lines"))).toBeGreaterThan(15);

  // caret이 갇히지 않았다 — 임계 돌파 뒤 친 글자가 코드에 들어간다.
  await panel.keyboard.type("ZZZ");
  expect(
    await panel.evaluate(
      () =>
        document
          .querySelector('[data-testid="code-collapse"] code')
          ?.textContent?.includes("ZZZ") ?? false,
    ),
  ).toBe(true);

  await panel.close();
  await fixture.close();
});
