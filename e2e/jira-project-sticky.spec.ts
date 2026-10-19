import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// Jira 프로젝트 sticky 복원 — jira-project-switch.spec이 쓰기(lastSubmitFields에 projectKey·
// issueTypeId·siteId 기록)를 고정하고, 이 파일이 읽기를 고정한다. 한 파일에 두면 제출 직후
// 패널이 done 화면이라 같은 탭에서 새 이슈 흐름으로 못 돌아간다.
// 원본 주석: 연동 탭의 projectKey는 "기본값"으로 강등되고, 제출 다이얼로그
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
// 패널이 부팅되기 전에 심는다(GOTCHAS "스파이를 addInitScript로") — 앞 spec이 남긴 제출 이슈의
// 상태 뱃지 조회가 spy를 못 타면 가짜 토큰 401로 전역 인증 만료 다이얼로그가 클릭을 가로챈다.
// 호출 뒤 reload해야 적용된다.
async function spySendMessage(panel: Page) {
  await panel.addInitScript((jiraUrl) => {
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
              : [
                  { id: "10001", name: "Bug" },
                  { id: "10002", name: "Task" },
                ],
        });
        return;
      }
      // 스프린트 판정·상태 뱃지 조회도 진짜 background로 나가면 401 → 인증 만료 다이얼로그.
      if (msg?.type === "jira.sprintFieldMeta") {
        cb?.({ ok: true, result: null });
        return;
      }
      if (msg?.type === "jira.getIssueStatus") {
        cb?.({
          ok: true,
          result: { name: "To Do", categoryKey: "new", issueTypeName: "Task" },
        });
        return;
      }
      if (msg?.type === "jira.uploadAttachment") {
          const attachment = (msg as unknown as { attachment: { fileId: string; filename: string } }).attachment;
          cb?.({ ok: true, result: { ...attachment, ok: true, href: "https://your.atlassian.net/attachment/logs", file: { kind: "external", url: "https://your.atlassian.net/attachment/logs" } } });
          return;
        }
        if (msg?.type === "jira.updateIssueDescription") {
        cb?.({ ok: true, result: { ok: true } });
        return;
      }
      if (msg?.type === "jira.createIssue") {
        (w.__jiraSubmits as unknown[]).push(
          (msg as unknown as { payload?: unknown }).payload,
        );
        cb?.({ ok: true, result: { key: "API-1", url: jiraUrl, siteId: "cloud-1" } });
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




// sticky의 읽기 쪽. 쓰기(위 describe의 lastSubmitFields 단언)와 갈라 둔 이유는 제출 직후 패널이
// done 화면이라 같은 탭에서 새 이슈 흐름으로 못 돌아가고, 탭을 새로 열어도 fixtureTabId가 패턴에
// 걸린 첫 탭(=done 상태인 원래 탭)을 집기 때문이다. 위에서 확인한 그 레코드를 그대로 seed한다.
test.describe.serial("Jira 프로젝트 sticky 복원", () => {
  let fixture: Page;
  let panel: Page;

  test.beforeAll(async ({ ext }) => {
    fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl("basic.html"));
    panel = await ext.openPanel(await ext.fixtureTabId());
    await panel.evaluate(
      ([key, val]) => chrome.storage.local.set({ [key]: val }),
      [
        SETTINGS_KEY,
        envelope({ projectKey: "API", issueTypeId: "20001", siteId: "cloud-1" }),
      ] as const,
    );
    await spySendMessage(panel);
    await panel.reload();
  });

  test.afterAll(async () => {
    await panel.evaluate((key) => chrome.storage.local.remove(key), SETTINGS_KEY);
    await panel.close();
    await fixture.close();
  });

  test("직전 제출 프로젝트로 열리고 계정 기본 이슈타입은 주입되지 않는다", async () => {
    await openSubmitDialog(panel, "Jira project sticky e2e");

    await expect(projectCombo(panel)).toContainText("API");
    // 직전 제출 이슈타입까지 함께 복원돼 바로 제출 가능하다.
    await expect(panel.getByTestId("submit-issue-confirm")).toBeEnabled();
    // enabled만으로는 *복원된 20001*과 *주입된 계정 기본 10001*을 구별하지 못한다 — R2 가드를
    // 지우면 트리거 라벨이 "Bug"로 뜨므로 거기서 갈린다.
    await expect(panel.getByTestId("jira-issue-type-combobox")).not.toContainText("Bug");
  });
});

// 같은 프로젝트에서 직전 제출 이슈타입이 계정 기본과 다른 경우. 목록은 콤보를 열어야 받는데, 그 전의
// 라벨이 계정 기본 이름으로 폴백하면 화면은 "Bug", 제출은 직전 타입으로 갈린다(사용자 리포트).
// 콤보를 열지 않은 채로 라벨과 제출 payload를 함께 판정해야 그 어긋남이 잡힌다.
async function awaitDurableSubmission(panel: Page) {
  await expect.poll(() => panel.evaluate(async () => {
    const raw = (await chrome.storage.local.get("bugshot-issues"))["bugshot-issues"];
    const record = JSON.parse(raw ?? "{}").state?.issues?.find((i: { key: string }) => i.key === "API-1");
    return { status: record?.status, recovery: !!record?.submissionRecoveryId };
  })).toEqual({ status: "submitted", recovery: false });
}

function submittedIssueTypeIds(panel: Page) {
  return panel.evaluate(() =>
    ((window as unknown as { __jiraSubmits?: { issueTypeId?: string }[] }).__jiraSubmits ?? []).map(
      (p) => p.issueTypeId,
    ),
  );
}

for (const [label, lastJira] of [
  ["이름과 함께 저장된 직전 제출", { projectKey: "WEB", issueTypeId: "10002", issueTypeName: "Task", siteId: "cloud-1" }],
  // 업데이트 이전 스냅샷 — 이름이 없어 라벨을 댈 데가 목록뿐이다.
  ["이름 없는 구 스냅샷", { projectKey: "WEB", issueTypeId: "10002", siteId: "cloud-1" }],
] as const) {
  test.describe.serial(`Jira 이슈타입 sticky (${label})`, () => {
    let fixture: Page;
    let panel: Page;

    test.beforeAll(async ({ ext }) => {
      fixture = await ext.context.newPage();
      await fixture.goto(ext.fixtureUrl("basic.html"));
      panel = await ext.openPanel(await ext.fixtureTabId());
      await panel.evaluate(
        ([key, val]) => chrome.storage.local.set({ [key]: val }),
        [SETTINGS_KEY, envelope(lastJira)] as const,
      );
      await spySendMessage(panel);
      await panel.reload();
      // 앞 describe의 패널 뒤에 열린 탭이라 rAF가 throttle돼 클릭 actionability가 멈춘다(GOTCHAS).
      await panel.bringToFront();
    });

    test.afterAll(async () => {
      await panel.evaluate(
        (keys) => chrome.storage.local.remove(keys),
        [SETTINGS_KEY, "bugshot-issues"],
      );
      await panel.close();
      await fixture.close();
    });

    test("콤보를 열지 않아도 직전 이슈타입 이름이 보이고 그 타입으로 제출된다", async () => {
      await openSubmitDialog(panel, `Jira issue type sticky e2e (${label})`);

      const combo = panel.getByTestId("jira-issue-type-combobox");
      await expect(combo).toContainText("Task");
      await expect(combo).not.toContainText("Bug");
      await expect(combo).toHaveAttribute("aria-expanded", "false");

      const confirm = panel.getByTestId("submit-issue-confirm");
      await expect(confirm).toBeEnabled();
      await confirm.click();

      await expect.poll(() => submittedIssueTypeIds(panel)).toEqual(["10002"]);
      await awaitDurableSubmission(panel);
    });
  });
}
