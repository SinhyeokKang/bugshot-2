import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// Jira 제출 시 스프린트 선택 — 필드의 존재 여부를 createmeta에 물어 "있다"일 때만 행을 그린다.
// 판정·목록·제출이 전부 background SW fetch라 모킹이 불가능해서 account를 storage seed하고
// sendMessage를 스파이로 가로챈다(jira-project-switch.spec의 패턴).
//
// seed 필수 3개: projectKey(없으면 SetupDialog가 자동으로 열려 판정을 가린다) · auth.cloudId
// (없으면 jiraSiteId가 undefined라 sticky의 sameSite 게이트가 공허하게 통과한다) · envelope
// version 11(기존 spec 다수가 10이라 마이그레이션 체인을 탄다).

const SETTINGS_KEY = "bugshot-settings";
const JIRA_URL = "https://your.atlassian.net/browse/WEB-1";

// 스프린트가 있는 이슈타입과 없는 이슈타입을 둘 다 둔다 — 행이 사라지는 경로를 이슈타입
// 전환으로만 판정할 수 있다(프로젝트를 바꾸면 다른 축까지 함께 움직인다).
const SPRINT_TYPE = "10001";
const NO_SPRINT_TYPE = "10002";

function envelope() {
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
          issueTypeId: SPRINT_TYPE,
          issueTypeName: "Bug",
          defaults: {},
        },
      },
      lastSubmitFields: {},
      titlePrefix: "",
    },
    version: 11,
  });
}

// 패널이 **부팅되기 전에** 심어야 한다. 이슈 목록의 상태 뱃지가 마운트 즉시 `jira.getIssueStatus`를
// 쏘는데, 그게 spy를 못 타고 진짜 background로 나가면 seed한 가짜 토큰이 401을 받아
// `onOAuthExpired` 전역 다이얼로그가 뜬다 — 그 오버레이가 이후 모든 클릭을 가로챈다.
async function spySendMessage(panel: Page) {
  await panel.addInitScript(
    ([jiraUrl, sprintType]: readonly [string, string]) => {
      const w = window as unknown as { __jiraSubmits?: unknown[] };
      w.__jiraSubmits = [];
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = ((
        msg: { type?: string; projectKey?: string; issueTypeId?: string },
        cb?: (r: unknown) => void,
      ) => {
        if (msg?.type === "jira.listProjects") {
          cb?.({ ok: true, result: [{ id: "1", key: "WEB", name: "Web App" }] });
          return;
        }
        if (msg?.type === "jira.listIssueTypes") {
          cb?.({
            ok: true,
            result: [
              { id: "10001", name: "Bug" },
              { id: "10002", name: "Chore" },
            ],
          });
          return;
        }
        // 존재 판정. 이슈타입에 따라 갈려야 "행이 사라진다"가 판정 가능해진다.
        if (msg?.type === "jira.sprintFieldMeta") {
          cb?.({
            ok: true,
            result:
              msg.issueTypeId === sprintType
                ? { fieldId: "customfield_10020", isArray: true }
                : null,
          });
          return;
        }
        if (msg?.type === "jira.listSprints") {
          cb?.({
            ok: true,
            result: {
              sprints: [
                { id: 42, name: "Sprint 24", state: "active" },
                { id: 43, name: "Sprint 25", state: "future" },
              ],
              multiBoard: false,
            },
          });
          return;
        }
        // sticky 검증 — 복원된 값이 유효하다고 답해야 이름이 트리거에 뜬다.
        if (msg?.type === "jira.getSprint") {
          cb?.({
            ok: true,
            result: { id: 42, name: "Sprint 24", state: "active" },
          });
          return;
        }
        if (msg?.type === "jira.submitIssue") {
          (w.__jiraSubmits as unknown[]).push(
            (msg as unknown as { payload?: unknown }).payload,
          );
          cb?.({ ok: true, result: { key: "WEB-1", url: jiraUrl } });
          return;
        }
        if (msg?.type === "analytics.capture") {
          cb?.({ ok: true, result: undefined });
          return;
        }
        // 앞 케이스가 남긴 submitted 이슈의 상태 뱃지 조회. 진짜 background로 나가면 401이다.
        if (msg?.type === "jira.getIssueStatus") {
          cb?.({
            ok: true,
            result: {
              name: "To Do",
              categoryKey: "new",
              issueTypeName: "Bug",
              summary: "seeded",
            },
          });
          return;
        }
        return orig(msg as never, cb as never);
      }) as typeof chrome.runtime.sendMessage;
    },
    [JIRA_URL, SPRINT_TYPE] as const,
  );
}

function sprintCombo(panel: Page) {
  return panel.getByTestId("jira-sprint-combobox");
}

async function draftToPreview(panel: Page, title: string) {
  await enterDebug(panel);
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  await panel.getByTestId("draft-title").fill(title);
  await panel.getByTestId("to-preview").click();
}

async function openSubmitDialog(panel: Page, title: string) {
  await draftToPreview(panel, title);
  const open = panel.getByTestId("issue-submit-open");
  await expect(open).toBeVisible();
  await open.click();
  await expect(panel.getByTestId("submit-issue-confirm")).toBeVisible();
}

async function submits(panel: Page) {
  return panel.evaluate(
    () =>
      (window as unknown as { __jiraSubmits?: Record<string, unknown>[] })
        .__jiraSubmits ?? [],
  );
}

async function selectIssueType(panel: Page, name: string) {
  await panel.getByTestId("jira-issue-type-combobox").click();
  await panel.getByRole("option", { name: new RegExp(name) }).click();
}

// 제출하면 패널이 done 화면에 머물고, 그 자리에서 새 이슈 흐름으로 되돌아갈 경로가 없다
// (jira-project-sticky.spec이 같은 이유로 파일을 갈랐다). 편집 세션 키가 `editor:${tabId}`라
// **탭이 다르면 세션도 새것**이므로, 케이스마다 fixture 페이지를 달리해 탭을 가른다.
// storage seed는 전역이라 한 번만 심으면 뒤에 열리는 패널이 전부 읽는다.
test.describe.serial("Jira 제출 시 스프린트 선택", () => {
  const opened: Page[] = [];

  async function openOn(
    ext: Parameters<Parameters<typeof test>[2]>[0]["ext"],
    page: string,
  ) {
    // 앞 케이스의 탭·패널을 먼저 닫는다. 남겨두면 배경 패널의 열린 레이어(오버레이)와
    // rAF throttle이 새 패널의 클릭 actionability를 흔든다("spec 간 탭 누수"의 파일 내 변형).
    for (const p of opened.splice(0)) await p.close();
    const fixture = await ext.context.newPage();
    await fixture.goto(ext.fixtureUrl(page));
    // 여러 fixture 탭이 열려 있으므로 패턴을 명시한다(포트는 match pattern에서 무시된다).
    const tabId = await ext.fixtureTabId(`http://127.0.0.1/${page}`);
    const panel = await ext.openPanel(tabId);
    // openPanel이 이미 goto한 뒤라 init script는 다음 로드부터 걸린다 — reload로 적용한다.
    await spySendMessage(panel);
    await panel.reload();
    opened.push(fixture, panel);
    // 앞 케이스의 탭들이 남아 있어 새 패널이 배경에 깔리면 rAF가 throttle돼 Playwright의
    // actionability(안정성) 검사가 영원히 끝나지 않는다 — 클릭 전 명시적으로 앞에 둔다.
    await panel.bringToFront();
    return panel;
  }

  test.beforeAll(async ({ ext }) => {
    await ext.evalInExt(
      ([key, val]) => chrome.storage.local.set({ [key]: val }),
      [SETTINGS_KEY, envelope()] as const,
    );
  });

  test.afterAll(async ({ ext }) => {
    await ext.evalInExt(
      (keys: string[]) => chrome.storage.local.remove(keys),
      [SETTINGS_KEY, "bugshot-issues"],
    );
    for (const p of opened) await p.close();
  });

  test("판정이 필드 있음이면 스프린트 행이 보이고 고른 값이 payload에 실린다", async ({
    ext,
  }) => {
    const panel = await openOn(ext, "basic.html");
    await openSubmitDialog(panel, "Jira sprint e2e");

    await expect(sprintCombo(panel)).toBeVisible();
    await sprintCombo(panel).click();
    await panel.getByRole("option", { name: /Sprint 24/ }).click();
    await expect(sprintCombo(panel)).toContainText("Sprint 24");

    const confirm = panel.getByTestId("submit-issue-confirm");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect.poll(() => submits(panel)).toHaveLength(1);
    const [payload] = await submits(panel);
    expect(payload.sprintId).toBe(42);
  });

  // 판정이 "없음"으로 확정되면 행이 사라지고, 직전 제출에서 복원된 값도 payload에서 빠진다.
  // 한쪽만 성립하면 사용자가 안 고른 스프린트로 제출되거나(값 잔존) 고른 값이 무음으로
  // 사라진다(행만 사라짐).
  test("스프린트 없는 이슈타입으로 바꾸면 행이 사라지고 복원된 값도 빠진다", async ({
    ext,
  }) => {
    const panel = await openOn(ext, "second.html");
    await openSubmitDialog(panel, "Jira sprint e2e 2");

    // 직전 제출값이 sticky로 돌아온다 — 검증 응답이 유효라 이름까지 뜬다.
    await expect(sprintCombo(panel)).toContainText("Sprint 24");

    await selectIssueType(panel, "Chore");
    await expect(sprintCombo(panel)).toHaveCount(0);

    const confirm = panel.getByTestId("submit-issue-confirm");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect.poll(() => submits(panel)).toHaveLength(1);
    const [payload] = await submits(panel);
    expect(payload.issueTypeId).toBe(NO_SPRINT_TYPE);
    // 스파이는 구조화 복제 **이전**에 잡으므로 undefined 프로퍼티가 아직 남아 있다(실제로
    // background에 도달하는 payload에선 사라진다). "키 부재"는 유닛이 create body로 고정하고,
    // 여기서는 값이 안 실렸다는 사실을 본다.
    expect(payload.sprintId).toBeUndefined();
  });

  // 재제출은 별도 진입점(DraftDetailDialog)이라 payload 조립이 한 벌 더 있다.
  // 한쪽만 고치면 이 경로가 무음으로 스프린트를 잃는다.
  test("저장된 드래프트를 재제출해도 payload에 스프린트가 실린다", async ({ ext }) => {
    const panel = await openOn(ext, "iframe.html");
    const title = "Jira sprint e2e 3";
    await draftToPreview(panel, title);

    const listTab = panel.getByTestId("tab-issue-list");
    await listTab.click();
    await expect(listTab).toHaveAttribute("data-state", "active");
    const row = panel.getByTestId("issue-row").filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.click();

    const detail = panel.getByTestId("draft-detail-dialog");
    await expect(detail).toBeVisible();
    await detail.getByTestId("detail-submit-open").click();
    await expect(panel.getByTestId("submit-issue-confirm")).toBeVisible();

    // 직전 제출이 스프린트 없는 이슈타입이었으므로 여기서 다시 고른다.
    await selectIssueType(panel, "Bug");
    await expect(sprintCombo(panel)).toBeVisible();
    await sprintCombo(panel).click();
    await panel.getByRole("option", { name: /Sprint 25/ }).click();

    const confirm = panel.getByTestId("submit-issue-confirm");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect.poll(() => submits(panel)).toHaveLength(1);
    const [payload] = await submits(panel);
    expect(payload.sprintId).toBe(43);
  });
});
