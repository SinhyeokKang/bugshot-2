import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// 이슈 파일 첨부 — 설정 토글(기본 OFF)이 drafting 첨부 섹션 노출을 게이팅하고,
// 다중 추가/개별 삭제/카운터·상한 비활성/세션 복원 유지가 동작하는지.
// 설정은 chrome.storage 영속이라 afterAll에서 OFF로 복원(후행 spec 오염 방지).

async function setAttachmentsEnabled(panel: Page, enabled: boolean) {
  // fresh 프로필 integrations 자동 전환 race를 active 폴링으로 흡수(settings-sections 패턴).
  await expect(async () => {
    await panel.getByTestId("tab-settings").click();
    await expect(panel.getByTestId("tab-settings")).toHaveAttribute(
      "data-state",
      "active",
    );
  }).toPass();
  await panel.getByTestId("settings-sub-issue").click();
  const sw = panel.locator(`[id="setting-attachments-enabled"]`);
  await expect(sw).toBeVisible();
  if (((await sw.getAttribute("data-state")) === "checked") !== enabled) {
    await sw.click();
  }
  await expect(sw).toHaveAttribute(
    "data-state",
    enabled ? "checked" : "unchecked",
  );
}

function files(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    name: `file-${offset + i}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`content-${offset + i}`),
  }));
}

test.describe.serial("이슈 파일 첨부", () => {
  let fixture: Page;
  let panel: Page;
  let tabId: number;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
  });

  test.afterAll(async () => {
    await setAttachmentsEnabled(panel, false);
    await panel.close();
    await fixture.close();
  });

  test("토글 OFF면 첨부 섹션 없음, ON이면 drafting에 노출", async () => {
    // 기본 OFF — freeform drafting 진입해도 첨부 버튼이 없다.
    await enterDebug(panel);
    await panel.getByTestId("mode-freeform").click();
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await expect(panel.getByTestId("attachment-add")).toHaveCount(0);

    // 토글 ON → debug 복귀 → 첨부 버튼이 노출된다.
    await setAttachmentsEnabled(panel, true);
    await enterDebug(panel);
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await expect(panel.getByTestId("attachment-add")).toBeVisible();
  });

  test("다중 파일 추가 → 리스트 표시, 카운터 갱신", async () => {
    await panel.getByTestId("attachment-input").setInputFiles(files(2));
    await expect(panel.getByTestId("attachment-item")).toHaveCount(2);
    await expect(panel.getByTestId("attachment-add")).toContainText("2/10");
  });

  test("개별 삭제 → 1개 남고 카운터 감소", async () => {
    await panel.getByTestId("attachment-remove").first().click();
    await expect(panel.getByTestId("attachment-item")).toHaveCount(1);
    await expect(panel.getByTestId("attachment-add")).toContainText("1/10");
  });

  test("상한(10) 도달 시 카운터 10/10 + 버튼 비활성", async () => {
    // 현재 1개 → 9개 추가 = 10개 상한.
    await panel.getByTestId("attachment-input").setInputFiles(files(9, 10));
    await expect(panel.getByTestId("attachment-item")).toHaveCount(10);
    await expect(panel.getByTestId("attachment-add")).toContainText("10/10");
    await expect(panel.getByTestId("attachment-add")).toBeDisabled();
  });

  test("패널 재오픈 후 첨부 리스트 유지(세션 복원)", async ({ ext }) => {
    // session snapshot 저장(debounce 300ms) 후 닫고 재오픈 → drafting+첨부 메타 복원.
    await panel.waitForTimeout(400);
    await panel.close();
    panel = await ext.openPanel(tabId);
    // 재오픈 시 debug 탭이 비활성이라 drafting-panel이 hidden — 탭 진입 후 복원 확인.
    await enterDebug(panel);
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await expect(panel.getByTestId("attachment-item")).toHaveCount(10);
  });

  test("토글 OFF면 첨부 섹션이 다시 숨겨진다", async () => {
    await setAttachmentsEnabled(panel, false);
    await enterDebug(panel);
    await expect(panel.getByTestId("drafting-panel")).toBeVisible();
    await expect(panel.getByTestId("attachment-add")).toHaveCount(0);
  });
});
