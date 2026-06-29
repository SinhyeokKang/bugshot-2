import { enterDebug, expect, test } from "./fixtures/extension";

// ClickUp 제출 게이팅 — List 미선택 시 제출 비활성, 선택(prefill) 시 활성.
// 제출 다이얼로그/플랫폼 필드는 OAuth 연결 account 전제라 실연결로는 e2e 미진입이고
// clickup.testPat/getLists는 background SW fetch라 모킹 불가. 그래서 account를 storage에
// 직접 seed해 우회하고, 대상값은 lastSubmitFields prefill로 채워 콤보박스(SW fetch) 없이 검증한다.
// fieldsReady(`workspaceId && listId`) 게이트 회귀 가드 (switch-exhaustive 폴백 누락 방지 영역).

const SETTINGS_KEY = "bugshot-settings";

function envelope(lastClickup?: Record<string, unknown>) {
  return JSON.stringify({
    state: {
      accounts: {
        clickup: {
          platform: "clickup",
          connectedAt: 1700000000000,
          auth: { kind: "pat", pat: "pk_test", viewerId: "u1", viewerName: "Tester" },
          defaults: {},
        },
      },
      lastSubmitFields: lastClickup ? { clickup: lastClickup } : {},
      titlePrefix: "",
    },
    version: 9,
  });
}

async function openSubmitDialog(
  ext: Parameters<Parameters<typeof test>[2]>[0]["ext"],
  seed: string,
) {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  // account를 패널 hydrate 전에 seed (AI spec의 storage seed 패턴) → reload로 persist 반영.
  await panel.evaluate(
    ([key, val]) => chrome.storage.local.set({ [key]: val }),
    [SETTINGS_KEY, seed] as const,
  );
  await panel.reload();

  // freeform으로 캡처 없이 drafting 진입 → 제목 입력 → preview(제출 버튼은 PreviewPanel에 있음).
  await enterDebug(panel);
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  await panel.getByTestId("draft-title").fill("ClickUp gating e2e");
  await panel.getByTestId("to-preview").click();

  const open = panel.getByTestId("issue-submit-open");
  await expect(open).toBeVisible();
  await open.click();
  return { fixture, panel };
}

async function cleanup(
  fixture: Awaited<ReturnType<typeof openSubmitDialog>>["fixture"],
  panel: Awaited<ReturnType<typeof openSubmitDialog>>["panel"],
) {
  await panel.evaluate((key) => chrome.storage.local.remove(key), SETTINGS_KEY);
  await panel.close();
  await fixture.close();
}

test.describe.serial("ClickUp 제출 게이팅", () => {
  test("List 미선택이면 제출 버튼 비활성", async ({ ext }) => {
    const { fixture, panel } = await openSubmitDialog(ext, envelope());

    const submit = panel.getByTestId("submit-issue-confirm");
    await expect(submit).toBeVisible();
    // 단일 연결 플랫폼이라 ClickUp 필드가 바로 노출 — List 미선택이라 제출 불가.
    await expect(submit).toBeDisabled();

    await cleanup(fixture, panel);
  });

  test("List이 prefill되면 제출 버튼 활성", async ({ ext }) => {
    const { fixture, panel } = await openSubmitDialog(
      ext,
      envelope({
        workspaceId: "w1",
        workspaceName: "WS",
        spaceId: "s1",
        spaceName: "SP",
        listId: "l1",
        listName: "List",
      }),
    );

    const submit = panel.getByTestId("submit-issue-confirm");
    await expect(submit).toBeVisible();
    // initialClickupFields가 last로 workspace+list를 prefill → fieldsReady 충족.
    await expect(submit).toBeEnabled();

    await cleanup(fixture, panel);
  });
});
