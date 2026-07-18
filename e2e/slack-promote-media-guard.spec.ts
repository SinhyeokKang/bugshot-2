import { expect, test } from "./fixtures/extension";

// 승격 데이터 소실 가드 — Slack 보존 이슈를 GitHub로 승격할 때 미디어 업로드가 실패(href:null)하면
// 이슈 생성(github.submitIssue) 전에 중단해 원본을 보존해야 한다(markSubmitted→stripSubmitted가
// slackPreserved·blob을 파괴하므로). GitHub 파일 업로드는 github.com 쿠키 세션이라 OAuth 토큰이
// 살아있어도 soft-fail(href:null)할 수 있는데, 과거엔 그대로 이슈를 만들고 원본을 날렸다.
//
// uploadFiles/submitIssue는 SW fetch라 panel의 chrome.runtime.sendMessage를 스파이로 대체한다
// (slack-issue-promotion 패턴). 이미지가 captureFiles에 들어가야 가드가 발동하므로 screenshot 모드
// 보존 이슈 + IndexedDB before 이미지 blob을 seed한다.

const SETTINGS_KEY = "bugshot-settings";
const ISSUES_KEY = "bugshot-issues";
const ISSUE_ID = "slk-media-1";
const SLACK_URL = "https://ws.slack.com/archives/C123/p1700000000123456";
const SLACK_TS = "1700000000.123456";

function settingsEnvelope() {
  const acct = (platform: string) => ({
    platform,
    connectedAt: 1700000000000,
    auth: { kind: "oauth", accessToken: `tok-${platform}`, grantedAt: 1700000000000 },
    defaults: {},
  });
  return JSON.stringify({
    state: {
      accounts: {
        slack: { ...acct("slack"), teamId: "T1", teamName: "Test Workspace", auth: { kind: "oauth", accessToken: "tok-slack", grantedAt: 1700000000000, viewerId: "U1", viewerName: "Tester" } },
        github: acct("github"),
      },
      // ghFields.owner/repo prefill — 없으면 handleGithubSubmit이 submitToGithub 전에 requiredMissing로
      // 일찍 throw해 업로드/가드 경로를 안 탄다.
      lastSubmitFields: { github: { owner: "o", repo: "r" } },
      titlePrefix: "",
    },
    version: 10,
  });
}

function issuesEnvelope() {
  return JSON.stringify({
    state: {
      issues: [
        {
          id: ISSUE_ID,
          status: "submitted",
          platform: "slack",
          slackPreserved: true,
          captureMode: "screenshot",
          title: "Slack media guard e2e",
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          submittedAt: 1700000000000,
          pageUrl: "http://127.0.0.1/basic.html",
          draft: { title: "Slack media guard e2e", sections: { description: "broken" } },
          snapshot: { before: true, after: false },
          key: SLACK_TS,
          url: SLACK_URL,
        },
      ],
    },
    version: 5,
  });
}

// screenshot 제출이 captureFiles.images=[screenshot.webp]를 만들도록 before 이미지 blob을 IndexedDB
// (bugshot-video DB, images store, key `${id}:before`)에 직접 넣는다. blobToDataUrl만 거치므로
// 내용은 임의 바이트면 충분. openDb와 동일한 v7 전 store 스키마로 열어 앱 open과 충돌하지 않게 한다.
async function seedBeforeImage(
  panel: Awaited<ReturnType<typeof seedAndOpenList>>["panel"],
) {
  await panel.evaluate(async (issueId) => {
    await new Promise<void>((resolve, reject) => {
      // 앱 openDb와 동일 스키마·버전이라야 VersionError가 안 난다(현재 DB_VERSION=8, store 8개).
      const req = indexedDB.open("bugshot-video", 8);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ["blobs", "images", "networkLogs", "consoleLogs", "actionLogs", "inlineImages", "inlineImageOrigins", "attachments"]) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("images", "readwrite");
        tx.objectStore("images").put(new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/webp" }), `${issueId}:before`);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  }, ISSUE_ID);
}

async function seedAndOpenList(
  ext: Parameters<Parameters<typeof test>[2]>[0]["ext"],
) {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  const panel = await ext.openPanel(tabId);

  await panel.evaluate(
    ([sk, sv, ik, iv]) => chrome.storage.local.set({ [sk]: sv, [ik]: iv }),
    [SETTINGS_KEY, settingsEnvelope(), ISSUES_KEY, issuesEnvelope()] as const,
  );
  await panel.reload();
  return { fixture, panel };
}

// github.uploadFiles는 요청된 모든 파일을 href:null(쿠키 세션 실패 모사)로, github.submitIssue는
// 호출 횟수만 기록하며 fake 성공. 가드가 작동하면 submitIssue는 0회여야 한다.
async function spyGithub(
  panel: Awaited<ReturnType<typeof seedAndOpenList>>["panel"],
) {
  await panel.evaluate(() => {
    const w = window as unknown as { __ghUpload?: number; __ghSubmit?: number };
    w.__ghUpload = 0;
    w.__ghSubmit = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = ((msg: { type?: string; files?: { filename: string }[] }, cb?: (r: unknown) => void) => {
      if (msg?.type === "github.uploadFiles") {
        w.__ghUpload = (w.__ghUpload ?? 0) + 1;
        cb?.({ ok: true, result: (msg.files ?? []).map((f) => ({ filename: f.filename, href: null })) });
        return;
      }
      if (msg?.type === "github.submitIssue") {
        w.__ghSubmit = (w.__ghSubmit ?? 0) + 1;
        cb?.({ ok: true, result: { number: 7, url: "https://github.com/o/r/issues/7" } });
        return;
      }
      return orig(msg as never, cb as never);
    }) as typeof chrome.runtime.sendMessage;
  });
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

test("GitHub 승격 중 미디어 업로드 실패 시 이슈 생성 전 중단 + 원본 Slack 이슈 보존", async ({ ext }) => {
  const { fixture, panel } = await seedAndOpenList(ext);
  await seedBeforeImage(panel);
  await spyGithub(panel);

  const listTab = panel.getByTestId("tab-issue-list");
  await expect(listTab).toBeVisible();
  await listTab.click();
  await expect(listTab).toHaveAttribute("data-state", "active");
  await expect(panel.getByTestId("issue-row")).toBeVisible();

  // 승격 → 제출 다이얼로그(github 단일 트래커라 탭 없이 바로 github 필드).
  await panel.getByTestId("promote-issue").click();
  const confirm = panel.getByTestId("submit-issue-confirm");
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // 업로드 실패 → 가드 throw → catch가 idle 복귀(버튼 재활성). 이때 submitIssue는 안 불렸어야.
  await expect(confirm).toBeEnabled();

  const counts = await panel.evaluate(() => {
    const w = window as unknown as { __ghUpload?: number; __ghSubmit?: number };
    return { upload: w.__ghUpload ?? 0, submit: w.__ghSubmit ?? 0 };
  });
  expect(counts.upload).toBeGreaterThanOrEqual(1); // 업로드 경로까지 실제로 진입했음(early bail 아님)
  expect(counts.submit).toBe(0); // 이슈 생성은 차단됨

  // 원본 보존 — markSubmitted가 안 돌아 slackPreserved/platform/status 불변.
  const raw = await panel.evaluate(
    (k) => chrome.storage.local.get(k).then((r) => r[k] as string),
    ISSUES_KEY,
  );
  const issue = JSON.parse(raw).state.issues[0];
  expect(issue.slackPreserved).toBe(true);
  expect(issue.platform).toBe("slack");
  expect(issue.status).toBe("submitted");

  await cleanup(fixture, panel);
});
