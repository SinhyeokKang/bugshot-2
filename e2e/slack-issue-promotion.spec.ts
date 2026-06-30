import { expect, test } from "./fixtures/extension";

// Slack 제출 이슈 승격 — Slack 보존 이슈(slackPreserved)는 데이터를 보존하고, Slack 제외
// 트래커가 1개 이상 연결되면 카드 우측에 [자세히]·[승격] 버튼이 뜬다. 본문 클릭은 permalink 이동(불변).
// 실제 Slack 제출(OAuth·SW fetch)은 e2e 불가라(slack-submit-gating 참고) account와 보존 이슈를
// storage seed해 우회한다 — bugshot-settings(accounts) + bugshot-issues(IssueRecord) 양쪽 seed.

const SETTINGS_KEY = "bugshot-settings";
const ISSUES_KEY = "bugshot-issues";
// 보존 이슈 url=원 메시지 permalink(/archives/<channel>/p<ts>), key=메시지 ts.
// parseSlackChannelId가 url에서 "C123"을, postSlackPromotionReply가 threadTs로 key를 쓴다.
const SLACK_URL = "https://ws.slack.com/archives/C123/p1700000000123456";
const SLACK_TS = "1700000000.123456";
// 승격 백링크 e2e가 가로채는 fake 트래커 결과(SW fetch 없이 jira.submitIssue 응답을 스파이로 대체).
const JIRA_URL = "https://your.atlassian.net/browse/BUG-123";

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
          key: SLACK_TS,
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

// jira.submitIssue를 fake 성공으로, slack.postMessage를 기록(또는 reject)으로 가로채는 스파이.
// 둘 다 sendBg→chrome.runtime.sendMessage 경유라 panel 컨텍스트에서 덮으면 SW fetch 없이 판정 가능.
// 그 외 메시지는 원래 핸들러로 통과. 기록은 window.__slackPosts(payload 배열)로 노출.
async function spySendMessage(
  panel: Awaited<ReturnType<typeof seedAndOpenList>>["panel"],
  rejectSlack = false,
) {
  await panel.evaluate(
    ([jiraUrl, reject]) => {
      const w = window as unknown as { __slackPosts?: unknown[] };
      w.__slackPosts = [];
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((msg: { type?: string; payload?: unknown }, cb?: (r: unknown) => void) => {
        if (msg?.type === "jira.submitIssue") {
          cb?.({ ok: true, result: { key: "BUG-123", url: jiraUrl } });
          return;
        }
        if (msg?.type === "slack.postMessage") {
          (w.__slackPosts as unknown[]).push(msg.payload);
          cb?.(reject ? { ok: false, error: "not_in_channel" } : { ok: true, result: { ts: "999" } });
          return;
        }
        return orig(msg as never, cb as never);
      }) as typeof chrome.runtime.sendMessage;
    },
    [JIRA_URL, rejectSlack] as const,
  );
}

async function promoteToJira(
  panel: Awaited<ReturnType<typeof seedAndOpenList>>["panel"],
) {
  await panel.getByTestId("promote-issue").click();
  await expect(panel.getByTestId("submit-issue-confirm")).toBeVisible();
  // 기본 선택 플랫폼이 비결정적이라 jira 탭을 명시 선택(fake가 jira.submitIssue를 가로채므로).
  await panel.getByTestId("platform-tab-jira").click();
  const confirm = panel.getByTestId("submit-issue-confirm");
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

async function slackPosts(
  panel: Awaited<ReturnType<typeof seedAndOpenList>>["panel"],
) {
  return panel.evaluate(
    () => (window as unknown as { __slackPosts?: Record<string, string>[] }).__slackPosts ?? [],
  );
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

  test("Jira로 승격하면 원 슬랙 스레드에 트래커 URL 댓글 1회 — channel·threadTs·text 검증", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenList(ext, ["slack", "jira", "github"]);
    await spySendMessage(panel);

    await promoteToJira(panel);

    // 승격 성공 화면(SubmitSuccessView) — fake 트래커 key 링크로 판정(i18n 무관).
    await expect(panel.getByRole("link", { name: "BUG-123" })).toBeVisible();

    const posts = await slackPosts(panel);
    expect(posts).toHaveLength(1);
    expect(posts[0].channelId).toBe("C123");
    expect(posts[0].threadTs).toBe(SLACK_TS);
    expect(posts[0].text).toContain(JIRA_URL);

    await cleanup(fixture, panel);
  });

  test("Slack 미연결 상태로 승격하면 slack.postMessage 0회 + 승격 성공", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenList(ext, ["jira", "github"]);
    await spySendMessage(panel);

    await promoteToJira(panel);

    await expect(panel.getByRole("link", { name: "BUG-123" })).toBeVisible();
    expect(await slackPosts(panel)).toHaveLength(0);

    await cleanup(fixture, panel);
  });

  test("slack.postMessage가 reject해도 승격 성공 화면이 정상 표시", async ({ ext }) => {
    const { fixture, panel } = await seedAndOpenList(ext, ["slack", "jira", "github"]);
    await spySendMessage(panel, true);

    await promoteToJira(panel);

    await expect(panel.getByRole("link", { name: "BUG-123" })).toBeVisible();
    // best-effort라 호출은 기록되되 reject가 승격 흐름을 막지 않는다.
    expect(await slackPosts(panel)).toHaveLength(1);

    await cleanup(fixture, panel);
  });
});
