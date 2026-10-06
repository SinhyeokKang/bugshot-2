import { expect, test } from "./fixtures/extension";
import { openSettings, setScreenLocale } from "./fixtures/settings";
import { LOCALES, type LocaleMode } from "../src/i18n/locales";

// 화면 언어 셀렉터 — 옵션 목록이 LOCALES 등록 순(ko·en·fr·es·de)으로 렌더되는지.
//
// 옵션 라벨 텍스트 단언의 정당성은 GOTCHAS "로케일 자체가 SUT" 항목을 따른다 — 라벨이
// 자기 언어 표기(endonym)라 현재 앱 로케일과 무관하게 같은 문자열이다. 반면 트리거
// (SelectValue)는 영속 로케일에 좌우돼 비결정이므로 단언하지 않는다(GOTCHAS "locale 비결정").
//
// 옵션은 열어서 읽기만 하고 **선택하지 않는다** — ext fixture가 { scope: "worker" } +
// workers: 1이라 한 샤드의 모든 spec이 하나의 프로필·chrome.storage를 공유한다. 골라버리면
// 후행 spec 전부가 그 로케일로 돈다(선택이 필요하면 issue-body-locale.spec처럼 복원까지).

// 라벨은 리터럴로 박는다 — LOCALE_LABELS에서 파생하면 그 테이블이 틀려도 통과하는 동어반복이
// 된다. 대신 Record<LocaleMode, …>로 두어 로케일이 늘면 컴파일이 여기를 채우라고 한다.
const LABELS: Record<LocaleMode, string> = {
  ko: "한국어", en: "English", fr: "Français", es: "Español", de: "Deutsch",
};
const EXPECTED_OPTIONS = LOCALES.map((code) => LABELS[code]);

test("화면 언어 셀렉터 — 옵션이 LOCALES 순서로 렌더된다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);
  try {
    await openSettings(panel, "general");
    const trigger = panel.getByTestId("settings-locale");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(panel.getByRole("option")).toHaveText(EXPECTED_OPTIONS);
    await panel.keyboard.press("Escape"); // 선택 없이 닫는다 — 로케일 미오염
  } finally {
    await panel.close();
    await fixture.close();
  }
});

test("es/de 화면 언어 선택이 즉시 반영되고 패널 재로드 후에도 유지된다", async ({ ext }, testInfo) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const panel = await ext.openPanel(await ext.fixtureTabId());
  await openSettings(panel, "general");
  const original = (await panel.getByTestId("settings-locale").innerText()).trim();
  try {
    for (const [label, tab] of [["Español", "Configuración"], ["Deutsch", "Einstellungen"]] as const) {
      await setScreenLocale(panel, label);
      await expect(panel.getByTestId("tab-settings")).toContainText(tab);
      await panel.setViewportSize({ width: 400, height: 800 });
      for (const tabId of ["tab-debug", "tab-integrations"] as const) {
        await panel.getByTestId(tabId).click();
        await expect(panel.getByTestId(tabId)).toHaveAttribute("data-state", "active");
        expect(await panel.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
        if (process.env.LOCALE_LAYOUT_SHOTS === "1") {
          await panel.screenshot({ path: testInfo.outputPath(`${label}-${tabId}.png`) });
        }
      }
      await openSettings(panel, "issue");
      await expect(panel.getByTestId("settings-body-locale")).toBeVisible();
      const geometry = await panel.evaluate(() => {
        const bodyLocale = document.querySelector('[data-testid="settings-body-locale"]')!.getBoundingClientRect();
        return { pageWidth: document.documentElement.scrollWidth, controlRight: bodyLocale.right };
      });
      expect(geometry.pageWidth).toBeLessThanOrEqual(400);
      expect(geometry.controlRight).toBeLessThanOrEqual(400);
      if (process.env.LOCALE_LAYOUT_SHOTS === "1") {
        await panel.screenshot({ path: testInfo.outputPath(`${label}-issue-settings.png`) });
      }
      await panel.reload();
      await openSettings(panel, "general");
      await expect(panel.getByTestId("settings-locale")).toHaveText(label);
    }
  } finally {
    await setScreenLocale(panel, original);
    await panel.close();
    await fixture.close();
  }
});
