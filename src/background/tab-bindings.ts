import { BROAD_HOST_ORIGINS } from "@/lib/broad-host-origins";
import { FROZEN_PHASES, originOf, pageKeyOf, sessionKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import { deleteNetworkLog, deleteConsoleLog, deleteActionLog } from "@/store/blob-db";
import type { BgInternalMessage } from "@/types/messages";

type SessionSnap = {
  target?: { url?: string };
  captureMode?: string;
  phase?: string;
};

const SIDEPANEL_PATH = "src/sidepanel/index.html";
const ACTIVATED_KEY = "sidePanel:activated";
const ACTIVATION_URL_PREFIX = "sidePanel:url:";

async function getActivatedSet(): Promise<Set<number>> {
  const data = await chrome.storage.session.get(ACTIVATED_KEY);
  const arr = (data[ACTIVATED_KEY] as number[] | undefined) ?? [];
  return new Set(arr);
}

// read-modify-write 직렬화: 동시 발화(탭 동시 닫힘 등) 시 last-write-wins로
// activated set 갱신이 유실되는 것을 막는다.
let activatedWriteQueue: Promise<void> = Promise.resolve();

function setActivated(tabId: number, on: boolean): Promise<void> {
  const task = activatedWriteQueue.then(async () => {
    const set = await getActivatedSet();
    if (on) set.add(tabId);
    else set.delete(tabId);
    await chrome.storage.session.set({ [ACTIVATED_KEY]: Array.from(set) });
  });
  activatedWriteQueue = task.catch(() => {});
  return task;
}

async function apply(tabId: number, url: string | undefined): Promise<void> {
  const supported = isSupportedUrl(url);
  const set = await getActivatedSet();
  const activated = set.has(tabId);

  // SW hibernation / 윈도우 이동으로 setOptions가 휘발돼 default_path(쿼리 없음)로
  // fallback되는 경로 차단. preserve 분기와 무관하게 idempotent하게 path 재등록.
  if (activated && supported) {
    try {
      await chrome.sidePanel.setOptions({
        tabId,
        path: `${SIDEPANEL_PATH}?tabId=${tabId}`,
        enabled: true,
      });
    } catch (err) {
      console.error("[bugshot] setOptions failed", err);
    }
  }

  const key = sessionKey(tabId);
  const data = await chrome.storage.session.get(key);
  const snap = data[key] as SessionSnap | undefined;
  if (shouldPreserveSession(snap)) return;

  if (!(activated && supported)) {
    try {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    } catch (err) {
      console.error("[bugshot] setOptions failed", err);
    }
  }
}

export function shouldPreserveSession(
  snap: { captureMode?: string; phase?: string } | undefined,
): boolean {
  if (!snap) return false;
  const mode = snap.captureMode;
  const phase = snap.phase ?? "";
  if (mode === "video") return true;
  if (mode === "screenshot" || mode === "element" || mode === "freeform")
    return FROZEN_PHASES.has(phase);
  return false;
}

async function clearIfPageChanged(
  tabId: number,
  newUrl: string | undefined,
): Promise<void> {
  const key = sessionKey(tabId);
  try {
    const data = await chrome.storage.session.get(key);
    const snap = data[key] as SessionSnap | undefined;
    if (!snap) return;
    if (shouldPreserveSession(snap)) {
      if (snap.captureMode === "element" && pageKeyOf(snap.target?.url) !== pageKeyOf(newUrl)) {
        chrome.tabs.sendMessage(tabId, { type: "picker.clear" }).catch(() => {});
      }
      return;
    }
    const prevUrl = snap.target?.url;
    if (!prevUrl) return;
    if (pageKeyOf(prevUrl) !== pageKeyOf(newUrl)) {
      await chrome.storage.session.remove(key);
    }
  } catch (err) {
    console.error("[bugshot] clearIfPageChanged", err);
  }
}

type NavigationAction =
  | "keep"
  | "clearSession"
  | "notifyDeferredExpiry"
  | "deactivate";

// cross-document 네비게이션 시 패널 처리 판정.
// 계약: sameOrigin=true면 호출부는 permissions.contains를 조회하지 않고
// broadGranted=false 고정 전달(effectiveSameOrigin이 이미 true라 결과 무영향).
export function resolveNavigationAction(input: {
  preserved: boolean;
  sameOrigin: boolean;
  pageKeyChanged: boolean;
  broadGranted: boolean;
  newUrlBroadCovered: boolean;
}): NavigationAction {
  const effectiveSameOrigin =
    input.sameOrigin || (input.broadGranted && input.newUrlBroadCovered);
  if (effectiveSameOrigin) {
    if (input.preserved) return "keep";
    return input.pageKeyChanged ? "clearSession" : "keep";
  }
  return input.preserved ? "notifyDeferredExpiry" : "deactivate";
}

const BROAD_COVERED_SCHEMES = new Set(["http:", "https:"]);

// 광역 host 권한(https://*/* + http://*/*)이 캡처 능력을 주는 URL인지.
// file:은 지원 URL이지만 광역 권한 범위 밖이라 명시적 스킴 체크로 배제.
function isBroadCoveredUrl(url: string | undefined): boolean {
  if (!url || !isSupportedUrl(url)) return false;
  try {
    return BROAD_COVERED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// 메인 프레임 cross-document 네비게이션 시작 시 호출.
// same-origin이면 패널을 유지하고 stale 세션만 정리, cross-origin이면 패널을 닫는다.
// 예외: 광역 host 권한 보유 + 새 URL이 광역 커버(http/https) 지원 URL이면
// cross-origin도 same-origin처럼 패널 유지.
// URL을 못 읽는 경우(activeTab 만료 + 광역 권한 미부여)는 cross-origin으로 간주한다.
async function deactivatePanelIfCrossOrigin(
  tabId: number,
  newUrl: string | undefined,
): Promise<void> {
  const key = sessionKey(tabId);
  try {
    const set = await getActivatedSet();
    if (!set.has(tabId)) return;
    const data = await chrome.storage.session.get(key);
    const snap = data[key] as SessionSnap | undefined;
    const preserved = shouldPreserveSession(snap);

    let refUrl = snap?.target?.url;
    if (!refUrl) {
      const urlKey = `${ACTIVATION_URL_PREFIX}${tabId}`;
      const urlData = await chrome.storage.session.get(urlKey);
      refUrl = urlData[urlKey] as string | undefined;
    }
    if (!refUrl) return;

    const oldOrigin = originOf(refUrl);
    const newOrigin = originOf(newUrl);
    const sameOrigin =
      oldOrigin != null && newOrigin != null && oldOrigin === newOrigin;

    let broadGranted = false;
    if (!sameOrigin) {
      try {
        broadGranted = await chrome.permissions.contains({
          origins: BROAD_HOST_ORIGINS,
        });
      } catch {
        // permissions API 실패 시 미보유로 간주(현행 분기 폴백)
      }
    }

    const action = resolveNavigationAction({
      preserved,
      sameOrigin,
      pageKeyChanged: pageKeyOf(refUrl) !== pageKeyOf(newUrl),
      broadGranted,
      newUrlBroadCovered: isBroadCoveredUrl(newUrl),
    });

    switch (action) {
      case "keep":
        return;
      case "clearSession":
        await chrome.storage.session.remove(key);
        return;
      case "notifyDeferredExpiry":
        chrome.runtime
          .sendMessage({ type: "activeTabExpiredDeferred", tabId } satisfies BgInternalMessage)
          .catch(() => {});
        return;
      case "deactivate":
        await setActivated(tabId, false);
        await chrome.sidePanel.setOptions({ tabId, enabled: false });
        await chrome.storage.session.remove(key);
        return;
      default:
        action satisfies never;
    }
  } catch (err) {
    console.error("[bugshot] deactivatePanelIfCrossOrigin", err);
  }
}

export function activateTab(tab: chrome.tabs.Tab): void {
  if (tab.id == null) return;
  if (!isSupportedUrl(tab.url)) return;
  const tabId = tab.id;

  void chrome.sidePanel.setOptions({
    tabId,
    path: `${SIDEPANEL_PATH}?tabId=${tabId}`,
    enabled: true,
  });
  void chrome.sidePanel
    .open({ tabId })
    .catch((err) => console.error("[bugshot] sidePanel.open", err));

  void setActivated(tabId, true);
  if (tab.url) {
    void chrome.storage.session.set({ [`${ACTIVATION_URL_PREFIX}${tabId}`]: tab.url });
  }
}

// 직전 활성 탭의 레코더를 멈춘다. port.onDisconnect(패널 닫기)만으로는 per-tab
// sidePanel에서 비활성 탭 패널 문서 destroy가 보장되지 않아 탭 전환 stop을 보완.
// sentinel 미보유 탭에는 no-op이라 무조건 보내도 안전(.catch로 미주입 탭 무시).
// 윈도우별로 직전 탭을 추적한다 — 단일 변수면 다른 윈도우 전환 시 여전히 보이는
// 탭을 끊어버린다(onActivated는 윈도우마다 발화).
const prevActiveTabByWindow = new Map<number, number>();

// 윈도우별 직전 활성 탭을 갱신하고, stop을 보내야 할 직전 탭 id를 돌려준다(없으면 null).
export function resolveTabSwitch(
  prevByWindow: Map<number, number>,
  windowId: number,
  tabId: number,
): number | null {
  const prevTabId = prevByWindow.get(windowId);
  prevByWindow.set(windowId, tabId);
  return prevTabId != null && prevTabId !== tabId ? prevTabId : null;
}

export function stopRecorders(tabId: number): void {
  chrome.tabs.sendMessage(tabId, { type: "networkRecorder.stop" }).catch(() => {});
  chrome.tabs.sendMessage(tabId, { type: "consoleRecorder.stop" }).catch(() => {});
  chrome.tabs.sendMessage(tabId, { type: "actionRecorder.stop" }).catch(() => {});
}

export function setupTabBindings(): void {
  chrome.action.onClicked.addListener(activateTab);

  chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    const prevTabId = resolveTabSwitch(prevActiveTabByWindow, windowId, tabId);
    if (prevTabId != null) stopRecorders(prevTabId);

    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return; // 활성화 직후 탭이 닫힘 — 적용할 게 없음
    }
    try {
      await apply(tabId, tab.url);
    } catch (err) {
      console.error("[bugshot] onActivated", err);
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    // cross-document 네비게이션 시작 시 origin 비교: same-origin이면 패널 유지(stale
    // 세션만 정리), cross-origin이면 패널 닫기 — 단 광역 host 권한 보유 시 커버
    // URL(http/https)로의 cross-origin은 same-origin처럼 유지. SPA same-document는 loading 없음.
    if (info.status === "loading") {
      void deactivatePanelIfCrossOrigin(tabId, info.url ?? tab.url);
      return;
    }
    if (info.url) {
      void clearIfPageChanged(tabId, info.url).then(() =>
        apply(tabId, info.url),
      );
    } else if (info.status === "complete") {
      void apply(tabId, tab.url);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId, { windowId }) => {
    // 직전 활성 탭 포인터가 닫힌 탭을 가리키면 제거 — 같은 id 재사용 시 무관 탭 stop 방지.
    if (prevActiveTabByWindow.get(windowId) === tabId) {
      prevActiveTabByWindow.delete(windowId);
    }
    void chrome.storage.session.remove([sessionKey(tabId), `${ACTIVATION_URL_PREFIX}${tabId}`]);
    void setActivated(tabId, false);
    deleteNetworkLog(`pending:${tabId}`).catch(() => {});
    deleteConsoleLog(`pending:${tabId}`).catch(() => {});
    deleteActionLog(`pending:${tabId}`).catch(() => {});
  });

  // 윈도우 종료 시 해당 윈도우의 직전 탭 엔트리 정리(누수 방지).
  chrome.windows.onRemoved.addListener((windowId) => {
    prevActiveTabByWindow.delete(windowId);
  });
}
