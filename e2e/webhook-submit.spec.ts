import type { Page } from "@playwright/test";
import { enterDebug, expect, test } from "./fixtures/extension";

// Custom Webhook — 연결 폼 게이트와 제출 동선. webhook.submit/webhook.test는 background SW
// fetch라 panel.route로 못 잡으므로(GOTCHAS.md) sendMessage를 스파이로 가로챈다
// (jira-project-switch.spec의 spySendMessage 패턴). 실제 multipart 왕복은 이 층에서 못 보고
// background 유닛(webhook-api.test.ts)과 docs/webhook-contract.md 레퍼런스 서버가 맡는다.
//
// 9탭 케이스가 이 spec의 고유 몫이다 — 9번째 PlatformId가 생기기 전까지 도달 불가였던
// 가로 스크롤 분기의 첫 픽셀 실측이고, 선례 spec들처럼 2~3개만 seed하면 영영 그리드에 머문다.

const SETTINGS_KEY = "bugshot-settings";
// 이슈는 settings와 다른 키에 쌓인다 — 이것도 같이 비우지 않으면 앞 케이스가 만든
// 제출됨 행이 남아 "행을 만들지 않는다" 단언이 그 유물에 걸린다(GOTCHAS.md 스토리지 오염).
const ISSUES_KEY = "bugshot-issues";
const HOOK_URL = "https://hooks.example.com/bugshot";

function webhookAccount(format: "multipart" | "json" = "multipart") {
  return {
    platform: "webhook",
    connectedAt: 1700000000000,
    auth: {
      url: HOOK_URL,
      secret: "s3cr3t-value",
      headers: [],
      format,
      ...(format === "json" ? { template: '{"text":"{{title}}"}' } : {}),
    },
  };
}

// 9탭 분기에 닿으려면 PlatformId 전량이 연결돼 있어야 한다. 각 계정의 셰이프는
// connectedPlatforms가 키 존재만 보므로 최소한으로 둔다.
function allNineAccounts() {
  return {
    jira: {
      platform: "jira",
      connectedAt: 1,
      auth: { kind: "oauth", accessToken: "t", cloudId: "c1", grantedAt: 1 },
      projectKey: "WEB",
      issueTypeId: "10001",
      issueTypeName: "Bug",
      defaults: {},
    },
    github: { platform: "github", connectedAt: 1, auth: { kind: "pat", pat: "p" }, defaults: {} },
    linear: { platform: "linear", connectedAt: 1, auth: { kind: "apiKey", apiKey: "k" }, defaults: {} },
    notion: { platform: "notion", connectedAt: 1, auth: { kind: "token", token: "t" }, defaults: {} },
    gitlab: {
      platform: "gitlab",
      connectedAt: 1,
      auth: { kind: "pat", pat: "p", baseUrl: "https://gitlab.com" },
      defaults: {},
    },
    asana: { platform: "asana", connectedAt: 1, auth: { kind: "pat", pat: "p" }, defaults: {} },
    clickup: { platform: "clickup", connectedAt: 1, auth: { kind: "pat", pat: "p" }, defaults: {} },
    slack: { platform: "slack", connectedAt: 1, auth: { kind: "oauth", accessToken: "t" }, defaults: {} },
    webhook: webhookAccount(),
  };
}

function envelope(accounts: Record<string, unknown>) {
  return JSON.stringify({
    state: { accounts, lastSubmitFields: {}, titlePrefix: "" },
    version: 12,
  });
}

async function seed(panel: Page, value: string) {
  await panel.evaluate(
    async ([key, val, issuesKey]) => {
      await chrome.storage.local.remove(issuesKey);
      await chrome.storage.local.set({ [key]: val });
    },
    [SETTINGS_KEY, value, ISSUES_KEY] as const,
  );
  await panel.reload();
}

async function spySendMessage(panel: Page, submitReply: Record<string, unknown>) {
  await panel.evaluate((reply) => {
    const w = window as unknown as { __webhookSubmits?: unknown[]; __webhookTests?: unknown[] };
    w.__webhookSubmits = [];
    w.__webhookTests = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((msg: { type?: string }, cb?: (r: unknown) => void) => {
      if (msg?.type === "webhook.submit") {
        (w.__webhookSubmits as unknown[]).push(msg);
        cb?.(reply);
        return;
      }
      if (msg?.type === "webhook.test") {
        (w.__webhookTests as unknown[]).push(msg);
        cb?.({ ok: true, result: undefined });
        return;
      }
      if (msg?.type === "analytics.capture") {
        cb?.({ ok: true, result: undefined });
        return;
      }
      return orig(msg as never, cb as never);
    }) as typeof chrome.runtime.sendMessage;
  }, submitReply);
}

async function openPanelOn(ext: Parameters<Parameters<typeof test>[2]>[0]["ext"]) {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);
  return { fixture, panel };
}

async function cleanup(fixture: Page, panel: Page) {
  await panel.evaluate((keys) => chrome.storage.local.remove(keys), [SETTINGS_KEY, ISSUES_KEY]);
  await panel.close();
  await fixture.close();
}

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

test.describe.serial("Custom Webhook 연결 폼", () => {
  test("연결 테스트가 2xx면 저장되고 다이얼로그가 닫힌다", async ({ ext }) => {
    const { fixture, panel } = await openPanelOn(ext);
    await panel.evaluate((keys) => chrome.storage.local.remove(keys), [SETTINGS_KEY, ISSUES_KEY]);
    await spySendMessage(panel, { ok: true, result: {} });

    await panel.getByTestId("tab-integrations").click();
    await panel.getByTestId("webhook-connect-entry").click();
    await panel.getByTestId("webhook-url").fill(HOOK_URL);
    await panel.getByTestId("webhook-test").click();
    await expect
      .poll(() => panel.evaluate(() => (window as unknown as { __webhookTests: unknown[] }).__webhookTests.length))
      .toBe(1);

    await panel.getByTestId("webhook-save").click();
    await expect(panel.getByTestId("webhook-url")).toBeHidden();
    const saved = await panel.evaluate(async (key) => {
      const raw = (await chrome.storage.local.get(key))[key] as string | undefined;
      return raw ? JSON.parse(raw).state?.accounts?.webhook?.auth?.url : null;
    }, SETTINGS_KEY);
    expect(saved).toBe(HOOK_URL);

    await cleanup(fixture, panel);
  });

  test("공인망 http는 저장이 거부되고 사유가 뜬다", async ({ ext }) => {
    const { fixture, panel } = await openPanelOn(ext);

    await panel.getByTestId("tab-integrations").click();
    await panel.getByTestId("webhook-connect-entry").click();
    await panel.getByTestId("webhook-url").fill("http://hooks.example.com/bugshot");
    await panel.getByTestId("webhook-save").click();

    await expect(panel.getByTestId("webhook-form-error")).toBeVisible();
    await expect(panel.getByTestId("webhook-url")).toBeVisible();
    const saved = await panel.evaluate(async (key) => {
      const raw = (await chrome.storage.local.get(key))[key] as string | undefined;
      return raw ? JSON.parse(raw).state?.accounts?.webhook ?? null : null;
    }, SETTINGS_KEY);
    expect(saved).toBeNull();

    await cleanup(fixture, panel);
  });
});

test.describe.serial("Custom Webhook 제출", () => {
  test("multipart 성공은 이슈 목록 행을 만든다", async ({ ext }) => {
    const { fixture, panel } = await openPanelOn(ext);
    await seed(panel, envelope({ webhook: webhookAccount() }));
    await spySendMessage(panel, {
      ok: true,
      result: { key: "BUG-1", url: "https://hooks.example.com/r/BUG-1" },
    });

    await openSubmitDialog(panel, "webhook multipart e2e");
    await expect(panel.getByTestId("webhook-submit-note")).toBeVisible();
    await panel.getByTestId("submit-issue-confirm").click();

    await expect
      .poll(() => panel.evaluate(() => (window as unknown as { __webhookSubmits: unknown[] }).__webhookSubmits.length))
      .toBe(1);
    await panel.getByTestId("tab-issue-list").click();
    await panel.getByTestId("filter-submitted").click();
    await expect(panel.getByTestId("issue-row").getByText("webhook multipart e2e")).toBeVisible();
    await expect(panel.getByTestId("webhook-submitted-badge")).toBeVisible();

    await cleanup(fixture, panel);
  });

  // json 템플릿은 응답을 읽지 않아 식별자가 없다 — 제출됨 행을 만들면 열 수 없는 링크가
  // 남는다. draft 행 자체는 preview 진입(confirmDraft)이 이미 만들어 뒀고 그대로 보존된다:
  // 수신 서버가 무엇을 했는지 모르는 채 원본을 파괴하지 않는다(Slack 보존과 같은 판단).
  test("json 모드 성공은 제출됨 행을 만들지 않고 draft를 보존한다", async ({ ext }) => {
    const { fixture, panel } = await openPanelOn(ext);
    await seed(panel, envelope({ webhook: webhookAccount("json") }));
    await spySendMessage(panel, { ok: true, result: {} });

    await openSubmitDialog(panel, "webhook json e2e");
    await panel.getByTestId("submit-issue-confirm").click();

    await expect
      .poll(() => panel.evaluate(() => (window as unknown as { __webhookSubmits: unknown[] }).__webhookSubmits.length))
      .toBe(1);
    await panel.getByTestId("tab-issue-list").click();
    await panel.getByTestId("filter-draft").click();
    await expect(panel.getByTestId("issue-row").getByText("webhook json e2e")).toBeVisible();
    await expect(panel.getByTestId("webhook-submitted-badge")).toBeHidden();

    await cleanup(fixture, panel);
  });

  test("제출이 실패하면 draft가 목록에 남는다", async ({ ext }) => {
    const { fixture, panel } = await openPanelOn(ext);
    await seed(panel, envelope({ webhook: webhookAccount() }));
    await spySendMessage(panel, { ok: false, error: { message: "boom", status: 500 } });

    await openSubmitDialog(panel, "webhook failure e2e");
    await panel.getByTestId("submit-issue-confirm").click();

    await expect
      .poll(() => panel.evaluate(() => (window as unknown as { __webhookSubmits: unknown[] }).__webhookSubmits.length))
      .toBe(1);
    await expect(panel.getByTestId("submit-fields-dialog")).toBeVisible();
    await panel.keyboard.press("Escape");
    await panel.getByTestId("tab-issue-list").click();
    await panel.getByTestId("filter-draft").click();
    await expect(panel.getByTestId("issue-row").getByText("webhook failure e2e")).toBeVisible();
    await expect(panel.getByTestId("webhook-submitted-badge")).toBeHidden();

    await cleanup(fixture, panel);
  });
});

// Task 0의 가로 스크롤 분기는 9번째 PlatformId가 생기기 전까지 프로덕션에서 도달 불가였다.
// 여기가 그 첫 픽셀 실측이고, 유닛(jsdom)은 레이아웃이 0이라 원리적으로 못 본다.
test.describe.serial("제출 탭 줄 — 9개 연결", () => {
  test("그리드를 버리고 가로 스크롤로 전부 도달 가능하다", async ({ ext }) => {
    const { fixture, panel } = await openPanelOn(ext);
    await seed(panel, envelope(allNineAccounts()));
    await spySendMessage(panel, { ok: true, result: { key: "K", url: "https://x/K" } });

    await openSubmitDialog(panel, "nine tabs e2e");

    const tablist = panel.getByTestId("submit-fields-dialog").getByRole("tablist");
    await expect(tablist).toBeVisible();
    expect(await tablist.getAttribute("class")).not.toMatch(/grid-cols-/);

    const triggers = tablist.getByRole("tab");
    await expect(triggers).toHaveCount(9);

    // 아이콘 14px + px-3 24px. 이 아래로 내려가면 아이콘이 잘린다 — "안 잘린다"를 눈대중
    // 문구로 두지 않고 수치로 잰다.
    for (let i = 0; i < 9; i++) {
      const box = await triggers.nth(i).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(38);
    }

    // 첫·마지막 트리거가 스크롤 뒤 실제로 눌린다(스크롤 컨테이너가 도달을 막지 않는다).
    await triggers.last().click();
    await expect(triggers.last()).toHaveAttribute("aria-selected", "true");
    await triggers.first().click();
    await expect(triggers.first()).toHaveAttribute("aria-selected", "true");

    await cleanup(fixture, panel);
  });
});
