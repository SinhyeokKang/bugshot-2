import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";
import { stubClipboard } from "./fixtures/clipboard";

// 이슈 본문 언어 — 화면 언어와 독립된 축. 복사·제출 본문의 섹션 헤딩만 바뀌고 사이드패널
// 화면은 화면 언어를 유지한다.
//
// 전제 두 개를 여기 박는다.
// ① **앱 로케일은 워커 프로필에 따라 비결정**이라(GOTCHAS "locale 비결정") 각 테스트는
//    설정 > 일반에서 화면 언어를 명시 선택해 먼저 결정화한다. 그 뒤에는 라벨 텍스트 단언이
//    정당하다 — 이 spec에서는 어느 언어가 어디에 나오는지가 곧 SUT다.
// ② **클립보드 read 인프라가 없다**(저장소 전체에 readText·grantPermissions 0건). 패널
//    컨텍스트에서 write를 스텁하고 페이지 전역에 캡처해 단언한다(freeform-draft.spec 선례).
//
// 설정은 chrome.storage에 영속되므로 afterAll에서 본문 언어를 `자동`으로, 화면 언어를 원래
// 값으로 되돌린다 — 안 되돌리면 같은 워커의 후행 spec이 오염된다.

// LOCALE_LABELS는 자기 언어 표기(한국어·English)라 화면 언어와 무관하게 같은 문자열이다.
const KO_LABEL = "한국어";

async function openSettings(panel: Page, sub: "issue" | "general") {
  // hydration 전 클릭 유실 — enterDebug와 같은 active 폴링으로 흡수.
  await expect(async () => {
    await panel.getByTestId("tab-settings").click();
    await expect(panel.getByTestId("tab-settings")).toHaveAttribute("data-state", "active");
  }).toPass();
  await panel.getByTestId(`settings-sub-${sub}`).click();
}

async function setScreenLocale(panel: Page, label: string) {
  await openSettings(panel, "general");
  const trigger = panel.getByTestId("settings-locale");
  await expect(trigger).toBeVisible();
  if ((await trigger.innerText()).trim() === label) return;
  await trigger.click();
  await panel.getByRole("option", { name: label, exact: true }).click();
  await expect(trigger).toHaveText(label);
}

// 본문 언어 옵션은 [auto, ...LOCALES] 순서로 렌더된다. auto 라벨은 "자동 ({lang})"처럼
// 해석 결과가 섞여 exact 매칭이 어려우므로 첫 옵션을 위치로 집는다.
async function setBodyLocale(panel: Page, label: string | "auto") {
  await openSettings(panel, "issue");
  const trigger = panel.getByTestId("settings-body-locale");
  await expect(trigger).toBeVisible();
  await trigger.click();
  if (label === "auto") {
    await panel.getByRole("option").first().click();
  } else {
    await panel.getByRole("option", { name: label, exact: true }).click();
  }
}

async function copiedText(panel: Page): Promise<string> {
  await panel.getByTestId("copy-markdown").click();
  await expect
    .poll(() =>
      panel.evaluate(
        () => (window as unknown as { __copiedTexts: string[] }).__copiedTexts.length,
      ),
    )
    .toBeGreaterThan(0);
  return panel.evaluate(
    () => (window as unknown as { __copiedTexts: string[] }).__copiedTexts.join("\n"),
  );
}

// 캡처 없이 preview까지 가는 최단 경로(freeform). 본문 언어는 캡처 모드와 직교라 이걸로 충분.
async function draftToPreview(panel: Page, description: string) {
  await enterDebug(panel);
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  await panel.getByTestId("draft-title").fill("body locale e2e");
  await panel
    .getByTestId("draft-section-description")
    .locator('[contenteditable="true"]')
    .fill(description);
  await panel.getByTestId("to-preview").click();
  await expect(panel.getByTestId("preview-section-description")).toContainText(description);
}

test.describe.serial("이슈 본문 언어", () => {
  let fixture: Page;
  let panel: Page;
  let originalScreenLabel: string;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);

    await openSettings(panel, "general");
    const trigger = panel.getByTestId("settings-locale");
    await expect(trigger).toBeVisible();
    originalScreenLabel = (await trigger.innerText()).trim();

    await setScreenLocale(panel, KO_LABEL);
  });

  test.afterAll(async () => {
    await setBodyLocale(panel, "auto");
    await setScreenLocale(panel, originalScreenLabel);
    await panel.close();
    await fixture.close();
  });

  test("본문 언어를 English로 바꿔도 사이드패널 화면은 한국어로 남는다", async () => {
    await setBodyLocale(panel, "English");

    await draftToPreview(panel, "screen stays korean");

    // 미리보기 섹션 제목·env 제목·복사 버튼 전부 미리보기 키셋(화면 언어)이다.
    await expect(panel.getByTestId("preview-section-description")).toContainText("발생 현상");
    await expect(panel.getByTestId("copy-markdown")).toHaveText("복사");
  });

  test("본문 언어 English → 복사 마크다운 헤딩이 영어다", async () => {
    await stubClipboard(panel);
    const copied = await copiedText(panel);

    expect(copied).toContain("## Environment");
    expect(copied).not.toContain("## 재현 환경");
    // 사용자가 쓴 본문은 번역 대상이 아니다 — 스캐폴딩만 바뀐다.
    expect(copied).toContain("screen stays korean");

    // 같은 클릭이 rich flavor도 실어야 한다(본문 언어는 두 flavor에 동일 적용).
    const html = await panel.evaluate(
      () => (window as unknown as { __copiedHtml: string[] }).__copiedHtml.join("\n"),
    );
    expect(html).toContain("Environment");
    expect(html).toMatch(/<\/(p|h1|h2|h3|li|td)>/);
  });

  test("본문 언어 자동 → 복사 마크다운 헤딩이 화면 언어를 따른다", async () => {
    await setBodyLocale(panel, "auto");

    await expect(async () => {
      await panel.getByTestId("tab-debug").click();
      await expect(panel.getByTestId("tab-debug")).toHaveAttribute("data-state", "active");
    }).toPass();
    await expect(panel.getByTestId("preview-section-description")).toBeVisible();

    await stubClipboard(panel);
    const copied = await copiedText(panel);

    expect(copied).toContain("## 재현 환경");
    expect(copied).not.toContain("## Environment");
  });

  test("본문 언어를 바꿔도 진행 중 draft의 섹션 입력값이 유지된다", async () => {
    await setBodyLocale(panel, "English");

    await expect(async () => {
      await panel.getByTestId("tab-debug").click();
      await expect(panel.getByTestId("tab-debug")).toHaveAttribute("data-state", "active");
    }).toPass();

    // 설정 store 변경이 editor store를 건드리지 않는다.
    await expect(panel.getByTestId("preview-section-description")).toContainText(
      "screen stays korean",
    );
    await expect(panel.getByRole("heading", { name: "body locale e2e" })).toBeVisible();
  });
});
