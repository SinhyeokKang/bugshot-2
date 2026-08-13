import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// Jira 프로젝트 제출 시 전환 — 연동 탭의 projectKey는 "기본값"으로 강등되고, 제출 다이얼로그
// 최상단 프로젝트 콤보가 이번 제출의 목적지를 정한다. jira.listProjects/listIssueTypes/submitIssue는
// 전부 background SW fetch라 모킹이 불가능해서, account를 storage seed하고 sendMessage를 스파이로
// 가로챈다(slack-issue-promotion.spec의 spySendMessage 패턴).
//
// seed 필수 2개: projectKey(없으면 JiraConnectForm의 SetupDialog가 자동으로 열려 판정을 가린다)와
// auth.cloudId(없으면 jiraSiteId가 undefined라 sameSite 게이트가 공허하게 통과한다).

const SETTINGS_KEY = "bugshot-settings";
const JIRA_URL = "https://your.atlassian.net/browse/API-1";

function envelope(lastJira?: Record<string, unknown>) {
  return JSON.stringify({
    state: {
      accounts: {
        jira: {
          platform: "jira",
          connectedAt: 1700000000000,
          auth: {
            kind: "oauth",
            accessToken: "tok-jira",
            cloudId: "cloud-1",
            grantedAt: 1700000000000,
          },
          projectKey: "WEB",
          issueTypeId: "10001",
          issueTypeName: "Bug",
          defaults: {},
        },
      },
      lastSubmitFields: lastJira ? { jira: lastJira } : {},
      titlePrefix: "",
    },
    version: 11,
  });
}

// 프로젝트별 이슈타입이 갈려야 "전환 후 B의 목록이 온다"를 판정할 수 있다.
async function spySendMessage(panel: Page) {
  await panel.evaluate((jiraUrl) => {
    const w = window as unknown as { __jiraSubmits?: unknown[] };
    w.__jiraSubmits = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((
      msg: { type?: string; query?: string; projectKey?: string },
      cb?: (r: unknown) => void,
    ) => {
      if (msg?.type === "jira.listProjects") {
        cb?.({
          ok: true,
          result: [
            { id: "1", key: "WEB", name: "Web App" },
            { id: "2", key: "API", name: "API Service" },
          ],
        });
        return;
      }
      if (msg?.type === "jira.listIssueTypes") {
        cb?.({
          ok: true,
          result:
            msg.projectKey === "API"
              ? [{ id: "20001", name: "Defect" }]
              : [{ id: "10001", name: "Bug" }],
        });
        return;
      }
      if (msg?.type === "jira.submitIssue") {
        (w.__jiraSubmits as unknown[]).push(
          (msg as unknown as { payload?: unknown }).payload,
        );
        cb?.({ ok: true, result: { key: "API-1", url: jiraUrl } });
        return;
      }
      return orig(msg as never, cb as never);
    }) as typeof chrome.runtime.sendMessage;
  }, JIRA_URL);
}

// freeform으로 캡처 없이 drafting → preview → 제출 다이얼로그. confirmDraft가 이때 돌아
// initialJiraFields로 issueFields.projectKey를 정한다(= sticky 판정 지점).
async function openSubmitDialog(panel: Page, title: string) {
  await enterDebug(panel);
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  await panel.getByTestId("draft-title").fill(title);
  await panel.getByTestId("to-preview").click();
  const open = panel.getByTestId("issue-submit-open");
  await expect(open).toBeVisible();
  await open.click();
  await expect(panel.getByTestId("submit-issue-confirm")).toBeVisible();
}

function projectCombo(panel: Page) {
  return panel.getByTestId("jira-project-combobox");
}

async function settingsState(panel: Page) {
  return panel.evaluate(async (key) => {
    const data = await chrome.storage.local.get(key);
    const raw = data[key] as string | undefined;
    if (!raw) return null;
    return (
      JSON.parse(raw) as {
        state?: {
          accounts?: { jira?: { projectKey?: string } };
          lastSubmitFields?: { jira?: Record<string, unknown> };
        };
      }
    ).state ?? null;
  }, SETTINGS_KEY);
}

async function accountProjectKey(panel: Page) {
  return (await settingsState(panel))?.accounts?.jira?.projectKey ?? null;
}

async function lastSubmitJira(panel: Page) {
  return (await settingsState(panel))?.lastSubmitFields?.jira ?? null;
}

test.describe.serial("Jira 프로젝트 제출 시 전환", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    const tabId = await ext.fixtureTabId();
    panel = await ext.openPanel(tabId);
    await panel.evaluate(
      ([key, val]) => chrome.storage.local.set({ [key]: val }),
      [SETTINGS_KEY, envelope()] as const,
    );
    await panel.reload();
    await spySendMessage(panel);
  });

  test.afterAll(async () => {
    await panel.evaluate((key) => chrome.storage.local.remove(key), SETTINGS_KEY);
    await panel.close();
    await fixture.close();
  });

  test("프로젝트를 바꾸면 이슈타입이 비고 전환한 프로젝트의 목록이 열린다", async () => {
    await openSubmitDialog(panel, "Jira project switch e2e");

    // 계정 기본 프로젝트로 열리고 기본 이슈타입이 자동 선택돼 제출이 가능한 상태.
    await expect(projectCombo(panel)).toContainText("WEB");
    await expect(panel.getByTestId("submit-issue-confirm")).toBeEnabled();

    await projectCombo(panel).click();
    await panel.getByText("API Service").click();

    // 전환 직후 이슈타입 콤보가 대신 열리고(제출 버튼이 잠긴 것에 대한 유일한 단서),
    // 그 목록은 전환한 프로젝트 기준이다 — 이전 프로젝트의 Bug가 남으면 안 된다.
    await expect(projectCombo(panel)).toContainText("API Service (API)");
    await expect(panel.getByRole("option", { name: /Defect/ })).toBeVisible();
    await expect(panel.getByRole("option", { name: /Bug/ })).toHaveCount(0);
    await expect(panel.getByTestId("submit-issue-confirm")).toBeDisabled();
  });

  test("전환한 프로젝트로 제출되고 연동 탭 기본 프로젝트는 그대로다", async () => {
    await panel.getByRole("option", { name: /Defect/ }).click();
    const confirm = panel.getByTestId("submit-issue-confirm");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            (window as unknown as { __jiraSubmits?: { projectKey?: string }[] })
              .__jiraSubmits ?? [],
        ),
      )
      .toHaveLength(1);
    const [payload] = await panel.evaluate(
      () =>
        (window as unknown as { __jiraSubmits?: { projectKey?: string }[] })
          .__jiraSubmits ?? [],
    );
    expect(payload.projectKey).toBe("API");

    // 연동 탭 UI를 열어 판정하지 않는다 — SetupDialog 자동 오픈 같은 부작용이 낀다.
    await expect.poll(() => accountProjectKey(panel)).toBe("WEB");

    // sticky의 입력. siteId가 빠지면 sameSite 게이트가 다음 업데이트에서 무음으로 사라진다.
    await expect.poll(() => lastSubmitJira(panel)).toMatchObject({
      projectKey: "API",
      issueTypeId: "20001",
      siteId: "cloud-1",
    });
  });
});
