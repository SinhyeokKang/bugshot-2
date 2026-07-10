import { enterDebug, expect, test } from "./fixtures/extension";

// 온보딩 라우팅 — 연동 0개여도 debug(캡처) 탭에 착지한다(integrations 자동 전환 없음).
// 연동을 유도하는 건 캡처·미리보기 화면의 `integrations-cta` 배너다.
// (e2e 프로필은 플랫폼을 연결하지 않으므로 기본이 연동 0개 경로)

const SETTINGS_KEY = "bugshot-settings";

// github은 jira와 달리 셋업 다이얼로그 자동 오픈이 없어 seed 부작용이 없다(GOTCHAS).
function connectedEnvelope() {
  return JSON.stringify({
    state: {
      accounts: {
        github: {
          platform: "github",
          connectedAt: 1700000000000,
          auth: { kind: "pat", pat: "ghp-test", viewerLogin: "tester" },
          defaults: {},
        },
      },
      lastSubmitFields: {},
      titlePrefix: "",
    },
    version: 10,
  });
}

test("연동 0개 → debug 탭 착지 + 캡처 화면에 연동 CTA 배너", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  // 자동 전환 없음 — 클릭 없이 debug가 active.
  await expect(panel.getByTestId("tab-debug")).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(panel.getByTestId("tab-integrations")).not.toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(panel.getByTestId("integrations-cta")).toBeVisible();
  // 배너는 안내일 뿐 — 캡처 플로우를 막지 않는다.
  await expect(panel.getByTestId("mode-element")).toBeEnabled();

  await panel.close();
  await fixture.close();
});

test("연동 CTA 배너 클릭 → integrations 탭 전환", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await enterDebug(panel);
  await panel.getByTestId("integrations-cta").click();

  await expect(panel.getByTestId("tab-integrations")).toHaveAttribute(
    "data-state",
    "active",
  );

  await panel.close();
  await fixture.close();
});

test("패널을 닫았다 다시 열어도 debug 탭 — 반복 리다이렉트 없음", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();

  const first = await ext.openPanel(tabId);
  await expect(first.getByTestId("tab-debug")).toHaveAttribute(
    "data-state",
    "active",
  );
  await first.close();

  // 재오픈 — 연동은 여전히 0개지만 integrations로 끌려가지 않는다.
  const second = await ext.openPanel(tabId);
  await expect(second.getByTestId("tab-debug")).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(second.getByTestId("integrations-cta")).toBeVisible();

  await second.close();
  await fixture.close();
});

test("previewing 화면에도 연동 CTA 배너 — 전환 의도가 가장 높은 지점", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  // freeform-draft.spec과 동일 경로로 previewing 도달.
  await enterDebug(panel);
  await panel.getByTestId("mode-freeform").click();
  await expect(panel.getByTestId("drafting-panel")).toBeVisible();
  await panel.getByTestId("draft-title").fill("Onboarding cta e2e");
  await panel.getByTestId("to-preview").click();
  await expect(panel.getByTestId("preview-section-description")).toBeVisible();

  await expect(panel.getByTestId("integrations-cta")).toBeVisible();
  // 배너(안내)와 제출 차단(disabled)은 목적이 달라 공존한다.
  await expect(panel.getByTestId("issue-submit-open")).toBeDisabled();

  await panel.getByTestId("integrations-cta").click();
  await expect(panel.getByTestId("tab-integrations")).toHaveAttribute(
    "data-state",
    "active",
  );

  await panel.close();
  await fixture.close();
});

test("연동 1개 이상이면 배너가 사라진다", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  try {
    await panel.evaluate(
      ([key, val]) => chrome.storage.local.set({ [key]: val }),
      [SETTINGS_KEY, connectedEnvelope()] as const,
    );
    await panel.reload();

    await enterDebug(panel);
    await expect(panel.getByTestId("mode-element")).toBeVisible();
    await expect(panel.getByTestId("integrations-cta")).toHaveCount(0);
  } finally {
    // seed를 지우지 않으면 후행 spec이 account를 물려받는다(GOTCHAS: 설정 영속 오염).
    await panel.evaluate(
      (key) => chrome.storage.local.remove(key),
      SETTINGS_KEY,
    );
    await panel.close();
    await fixture.close();
  }
});
