import { expect, test } from "./fixtures/extension";

// Slack 제출 이슈 승격 — Slack 보존 이슈(slackPreserved)는 데이터를 보존하고, Slack 제외
// 트래커가 1개 이상 연결되면 카드 우측에 [자세히]·[승격] 버튼이 뜬다. 본문 클릭은 permalink 이동(불변).
// 실제 Slack 제출(OAuth·SW fetch)은 e2e 불가라(slack-submit-gating 참고) account와 보존 이슈를
// storage seed해 우회한다 — bugshot-settings(accounts) + bugshot-issues(IssueRecord) 양쪽 seed.

const SETTINGS_KEY = "bugshot-settings";
const ISSUES_KEY = "bugshot-issues";
const SLACK_URL = "https://app.slack.com/client/T1/C123/p1700000000";

function acct(platform: string) {
  const base = {
    platform,
    connectedAt: 1700000000000,
    auth: { kind: "oauth", accessToken: `tok-${platform}`, grantedAt: 1700000000000 },
    defaults: {},
  };
  if (platform === "slack") {
    return { ...base, teamId: "T1", teamName: "Test Workspace", auth: { ...base.auth, viewerId: "U1", viewerName: "Tester" } };
  }
  // jira는 projectKey가 없으면 JiraConnectForm이 "프로젝트 선택" 다이얼로그를 모달로 자동 오픈한다(항상 마운트).
  if (platform === "jira") {
    return { ...base, projectKey: "BUG", issueTypeId: "10001", issueTypeName: "Bug" };
  }
  return base;
}

// promotable: slack + 트래커 2개(jira·github) → 승격 다이얼로그에 플랫폼 탭이 떠 Slack 제외를 검증 가능.
function settingsEnvelope(platforms: string[]) {
  const accounts: Record<string, unknown> = {};
  for (const p of platforms) accounts[p] = acct(p);
  return JSON.stringify({
    state: { accounts, lastSubmitFields: {}, titlePrefix: "" },
    version: 10,
  });
}

function issuesEnvelope() {
  return JSON.stringify({
    state: {
      issues: [
        {
          id: "slk-promote-1",
          status: "submitted",
          platform: "slack",
          slackPreserved: true,
          title: "Slack promote e2e",
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          submittedAt: 1700000000000,
          pageUrl: "http://127.0.0.1/basic.html",
          draft: { title: "Slack promote e2e", sections: { description: "broken" } },
          snapshot: { before: false, after: false },
          key: "C123",
          url: SLACK_URL,
        },
      ],
    },
    version: 5,
  });
}

async function seedAndOpenList(
  ext: Parameters<Parameters<typeof test>[2]>[0]["ext"],
  platforms: string[],
) {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await panel.evaluate(
    ([sk, sv, ik, iv]) =>
      chrome.storage.local.set({ [sk]: sv, [ik]: iv }),
    [SETTINGS_KEY, settingsEnvelope(platforms), ISSUES_KEY, issuesEnvelope()] as const,
  );
  await panel.reload();

  const listTab = panel.getByTestId("tab-issue-list");
  await expect(listTab).toBeVisible();
  await listTab.click();
  await expect(listTab).toHaveAttribute("data-state", "active");
  await expect(panel.getByTestId("issue-row")).toBeVisible();
  return { fixture, panel };
}

async function cleanup(
  fixture: Awaited<ReturnType<typeof seedAndOpenList>>["fixture"],
  panel: Awaited<ReturnType<typeof seedAndOpenList>>["panel"],
) {
  await panel.evaluate(
    ([sk, ik]) => {
      chrome.storage.local.remove(sk);
      chrome.storage.local.remove(ik);
    },
    [SETTINGS_KEY, ISSUES_KEY] as const,
  );
  await panel.close();
  await fixture.close();
}

test.describe.serial("Slack 이슈 승격", () => {
  test("트래커 연결 시 카드 우측에 [자세히]·[승격] 노출", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenList(ext, ["slack", "jira", "github"]);

    await expect(panel.getByTestId("view-detail-issue")).toBeVisible();
    await expect(panel.getByTestId("promote-issue")).toBeVisible();

    await cleanup(fixture, panel);
  });

  test("promotable 카드 본문 클릭은 permalink 이동 — draft-detail-dialog 안 열림", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenList(ext, ["slack", "jira", "github"]);

    // chrome.tabs.create를 스파이로 교체 — 실제 새 탭(누수) 막고 호출 URL만 기록.
    await panel.evaluate(() => {
      (window as unknown as { __lastTabUrl?: string }).__lastTabUrl = undefined;
      chrome.tabs.create = ((args: { url?: string }) => {
        (window as unknown as { __lastTabUrl?: string }).__lastTabUrl = args.url;
        return Promise.resolve({} as chrome.tabs.Tab);
      }) as typeof chrome.tabs.create;
    });

    await panel.getByText("Slack promote e2e").click();

    await expect(panel.getByTestId("draft-detail-dialog")).toHaveCount(0);
    const url = await panel.evaluate(
      () => (window as unknown as { __lastTabUrl?: string }).__lastTabUrl,
    );
    expect(url).toBe(SLACK_URL);

    await cleanup(fixture, panel);
  });

  test("[자세히] 클릭 → draft-detail-dialog 열림 (제출 다이얼로그 자동 오픈 안 함)", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenList(ext, ["slack", "jira", "github"]);

    await panel.getByTestId("view-detail-issue").click();
    await expect(panel.getByTestId("draft-detail-dialog")).toBeVisible();
    // 제출 다이얼로그(SubmitFieldsDialog)는 자동으로 열리지 않는다.
    await expect(panel.getByTestId("submit-issue-confirm")).toHaveCount(0);

    await cleanup(fixture, panel);
  });

  test("[승격] 클릭 → 제출 다이얼로그 열림 + Slack 탭 없음", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenList(ext, ["slack", "jira", "github"]);

    await panel.getByTestId("promote-issue").click();
    // autoOpenSubmit → SubmitFieldsDialog 자동 오픈.
    await expect(panel.getByTestId("submit-issue-confirm")).toBeVisible();
    // 트래커 2개라 플랫폼 탭이 뜨고 — Slack 탭은 제외되어야 한다.
    await expect(panel.getByTestId("platform-tab-jira")).toBeVisible();
    await expect(panel.getByTestId("platform-tab-github")).toBeVisible();
    await expect(panel.getByTestId("platform-tab-slack")).toHaveCount(0);

    await cleanup(fixture, panel);
  });

  test("Slack 보존 이슈는 submitted 필터엔 보이고 draft 필터엔 안 보인다", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenList(ext, ["slack", "jira", "github"]);

    await panel.getByTestId("filter-submitted").click();
    await expect(panel.getByTestId("issue-row")).toHaveCount(1);

    await panel.getByTestId("filter-draft").click();
    await expect(panel.getByTestId("issue-row")).toHaveCount(0);

    await cleanup(fixture, panel);
  });

  test("트래커 미연결(Slack만) → 두 버튼 없고 Slack 배지 유지", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenList(ext, ["slack"]);

    await expect(panel.getByTestId("view-detail-issue")).toHaveCount(0);
    await expect(panel.getByTestId("promote-issue")).toHaveCount(0);
    await expect(panel.getByTestId("slack-submitted-badge")).toBeVisible();

    await cleanup(fixture, panel);
  });
});
