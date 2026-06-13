import type { Worker } from "@playwright/test";
import { expect, test } from "./fixtures/extension";
import type { ExtContext } from "./fixtures/extension";

// 광역 host 권한 보유 시 패널 유지 정책 (resolveNavigationAction 통합).
// e2e 빌드는 host_permissions에 <all_urls>를 넣어 chrome.permissions.contains({http/https *})가
// 항상 true → "광역 보유" 경로만 자동 검증 가능(미보유 닫힘·deferred는 수동 전용, tasks.md).
//
// 관찰 신호: e2e 패널은 실제 side panel이 아니라 일반 Page라 setOptions(enabled:false)로 닫히지
// 않아 close 이벤트로 판정할 수 없다. 대신 bg가 유지하는 activated set / 세션 키를 SW storage로
// 읽어 deactivate 여부를 판정한다.
// activated set은 보통 액션 아이콘 클릭(activateTab)으로 채워지지만 Playwright는 확장 액션을
// 클릭할 수 없다 → deactivatePanelIfCrossOrigin의 "미활성 탭 early-return" 가드를 넘기기 위해
// SW로 직접 seed한다(자연 도달 불가한 전제 조건의 셋업). 탭 닫힘 시 onRemoved가 seed 키를 정리한다.

const ACTIVATED_KEY = "sidePanel:activated";

function sw(ext: ExtContext): Worker {
  const w = ext.context.serviceWorkers()[0];
  if (!w) throw new Error("service worker 없음");
  return w;
}

async function seedActivatedSession(ext: ExtContext, tabId: number, refUrl: string): Promise<void> {
  await sw(ext).evaluate(
    (a: { activatedKey: string; urlKey: string; sessionKey: string; tabId: number; refUrl: string }) =>
      chrome.storage.session.set({
        [a.activatedKey]: [a.tabId],
        [a.urlKey]: a.refUrl,
        // 비보존(element/styling) 세션 — 커버 URL 이동 시 clearSession 대상이 된다.
        [a.sessionKey]: { target: { url: a.refUrl }, captureMode: "element", phase: "styling" },
      }),
    {
      activatedKey: ACTIVATED_KEY,
      urlKey: `sidePanel:url:${tabId}`,
      sessionKey: `editor:${tabId}`,
      tabId,
      refUrl,
    },
  );
}

function isActivated(ext: ExtContext, tabId: number): Promise<boolean> {
  return sw(ext).evaluate(
    (a: { key: string; tabId: number }) =>
      chrome.storage.session
        .get(a.key)
        .then((d) => ((d[a.key] as number[] | undefined) ?? []).includes(a.tabId)),
    { key: ACTIVATED_KEY, tabId },
  );
}

function hasSession(ext: ExtContext, tabId: number): Promise<boolean> {
  return sw(ext).evaluate(
    (a: { key: string }) => chrome.storage.session.get(a.key).then((d) => d[a.key] != null),
    { key: `editor:${tabId}` },
  );
}

test("광역 권한 보유: cross-origin 커버 URL 이동 → 패널 유지(세션만 정리, activated 보존)", async ({
  ext,
}) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  await seedActivatedSession(ext, tabId, ext.fixtureUrl("basic.html"));

  // 127.0.0.1 → localhost: 같은 fixture 서버, origin 상이, 둘 다 http 커버 범위.
  const port = new URL(ext.fixtureUrl("")).port;
  await fixture.goto(`http://localhost:${port}/basic.html`);

  // 커버 URL을 same-origin처럼 처리 → 비보존 세션만 clearSession (핸들러 실행 증거).
  await expect.poll(() => hasSession(ext, tabId)).toBe(false);
  // deactivate가 아니므로 activated set은 보존된다 (legacy였다면 여기서 빠졌을 것).
  expect(await isActivated(ext, tabId)).toBe(true);

  await fixture.close();
});

test("광역 권한 보유라도 비커버 URL(chrome://) 이동 → 패널 종료(deactivate)", async ({ ext }) => {
  const fixture = await ext.context.newPage();
  await fixture.goto(ext.fixtureUrl("basic.html"));
  const tabId = await ext.fixtureTabId();
  await seedActivatedSession(ext, tabId, ext.fixtureUrl("basic.html"));

  // chrome://는 지원 스킴 밖이라 newUrlBroadCovered=false → 현행 deactivate 분기.
  await fixture.goto("chrome://version");

  await expect.poll(() => isActivated(ext, tabId)).toBe(false);

  await fixture.close();
});
