import { enterDebug, expect, test } from "./fixtures/extension";

// Slack 제출 게이팅 — 채널 미선택 시 제출 비활성, 선택(prefill) 시 활성.
// Slack은 메시지 앱이라 OAuth user token 전용이고, listChannels는 background SW fetch라
// 모킹 불가. clickup-submit-gating과 같은 패턴으로 account를 storage seed해 우회 연결하고,
// 채널은 lastSubmitFields prefill로 채워 콤보박스(SW fetch) 없이 fieldsReady(`channelId`)를 검증한다.

const SETTINGS_KEY = "bugshot-settings";

function envelope(lastSlack?: Record<string, unknown>) {
  return JSON.stringify({
    state: {
      accounts: {
        slack: {
          platform: "slack",
          connectedAt: 1700000000000,
          auth: {
            kind: "oauth",
            accessToken: "xoxp-test",
            grantedAt: 1700000000000,
            viewerId: "U1",
            viewerName: "Tester",
          },
          teamId: "T1",
          teamName: "Test Workspace",
          defaults: {},
        },
      },
      lastSubmitFields: lastSlack ? { slack: lastSlack } : {},
      titlePrefix: "",
    },
    version: 10,
  });
}

async function seedAndOpenPanel(
  ext: Parameters<Parameters<typeof test>[2]>[0]["ext"],
  seed: string,
) {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  // account를 패널 hydrate 전에 seed (AI/clickup storage seed 패턴) → reload로 persist 반영.
  await panel.evaluate(
    ([key, val]) => chrome.storage.local.set({ [key]: val }),
    [SETTINGS_KEY, seed] as const,
  );
  await panel.reload();
  return { fixture, panel };
}

async function openSubmitDialog(
  ext: Parameters<Parameters<typeof test>[2]>[0]["ext"],
  seed: string,
) {
  const { fixture, panel } = await seedAndOpenPanel(ext, seed);

  // freeform으로 캡처 없이 drafting 진입 → 제목 입력 → preview(제출 버튼은 PreviewPanel에 있음).
  await enterDebug(panel);
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  await panel.getByTestId("draft-title").fill("Slack gating e2e");
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

test.describe.serial("Slack 제출 게이팅", () => {
  test("연결 시 연동 탭에 워크스페이스 이름이 노출된다", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenPanel(ext, envelope());

    const intTab = panel.getByTestId("tab-integrations");
    await expect(intTab).toBeVisible();
    await intTab.click();
    await expect(intTab).toHaveAttribute("data-state", "active");
    // SlackConnectedBody(SlackSummary)가 seed한 워크스페이스 이름을 노출 — i18n 무관 seed값.
    await expect(panel.getByText("Test Workspace")).toBeVisible();

    await cleanup(fixture, panel);
  });

  test("채널 미선택이면 제출 버튼 비활성", async ({ ext }) => {
    const { fixture, panel } = await openSubmitDialog(ext, envelope());

    const submit = panel.getByTestId("submit-issue-confirm");
    await expect(submit).toBeVisible();
    // 단일 연결 플랫폼이라 Slack 필드가 바로 노출 — 채널 미선택이라 제출 불가.
    await expect(submit).toBeDisabled();

    await cleanup(fixture, panel);
  });

  test("채널이 prefill되면 제출 버튼 활성", async ({ ext }) => {
    const { fixture, panel } = await openSubmitDialog(
      ext,
      envelope({ channelId: "C1", channelName: "#general" }),
    );

    const submit = panel.getByTestId("submit-issue-confirm");
    await expect(submit).toBeVisible();
    // initialSlackFields가 last로 channelId를 prefill → fieldsReady 충족.
    await expect(submit).toBeEnabled();

    await cleanup(fixture, panel);
  });
});
