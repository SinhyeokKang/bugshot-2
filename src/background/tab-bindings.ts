import { FROZEN_PHASES, originOf, pageKeyOf, sessionKey, pendingKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import { deleteNetworkLog, deleteConsoleLog, deleteActionLog, deleteVideoBlob } from "@/store/blob-db";
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

// 패널 표시 여부는 activation만 따른다 — 지원 여부를 여기서 보면 미지원 탭에서 방금 연 패널을
// onActivated(탭 전환 복귀)·onUpdated가 곧바로 enabled:false로 닫는다. 지원 여부는 패널이
// 무엇을 그리는지만 결정한다(useTabSupport).
async function apply(tabId: number): Promise<void> {
  const set = await getActivatedSet();
  const activated = set.has(tabId);

  // SW hibernation / 윈도우 이동으로 setOptions가 휘발돼 default_path(쿼리 없음)로
  // fallback되는 경로 차단. preserve 분기와 무관하게 idempotent하게 path 재등록.
  if (activated) {
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

  if (!activated) {
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
// <all_urls> required 승격 후 호출부는 broadGranted=true 고정 전달 — broadGranted=false 입력은
// 프로덕션에서 도달 불가하며 순수함수 회귀 자산(tab-bindings.test.ts legacyCases)으로만 남는다.
export function resolveNavigationAction(input: {
  preserved: boolean;
  sameOrigin: boolean;
  pageKeyChanged: boolean;
  broadGranted: boolean;
  newUrlBroadCovered: boolean;
  // 판독 가능 여부와 지원 여부를 별도 축으로 둔다 — isSupportedUrl(undefined)도 false라
  // 한 축으로 접으면 "URL을 못 읽었다"가 "미지원"으로 접혀 file: 동작까지 함께 바뀐다.
  newUrlReadable: boolean;
  newUrlSupported: boolean;
  // 판독 불가일 때의 폴백 판정용. 출발지가 이미 미지원이면 보호할 file:이 없다.
  prevUrlSupported: boolean;
}): NavigationAction {
  const effectiveSameOrigin =
    input.sameOrigin || (input.broadGranted && input.newUrlBroadCovered);
  if (effectiveSameOrigin) {
    if (input.preserved) return "keep";
    return input.pageKeyChanged ? "clearSession" : "keep";
  }
  if (input.preserved) return "notifyDeferredExpiry";
  // 판독됐으면 그대로 판정한다 — 미지원(chrome://·웹스토어)이면 패널을 살려 안내를 그리게 하고,
  // 지원 스킴(광역 커버 밖의 file:)이면 캡처 권한이 없는 상태라 현행대로 닫는다.
  if (input.newUrlReadable) return input.newUrlSupported ? "deactivate" : "clearSession";
  // 판독 불가는 chrome://와 file:(파일 접근 OFF)를 구분할 수 없다. 출발지로 가른다 —
  // 이미 미지원 페이지였다면 보호할 file:이 없으므로 패널을 유지한다(미지원 안에서의 이동).
  // 이 폴백이 없으면 activeTab 그랜트가 회수된 뒤의 두 번째 이동에서 패널이 다시 닫힌다.
  return input.prevUrlSupported ? "deactivate" : "clearSession";
}

const BROAD_COVERED_SCHEMES = new Set(["http:", "https:"]);

// 광역 host 권한(<all_urls>)이 captureVisibleTab 캡처 능력을 주는 URL인지.
// <all_urls>는 file:도 포함하지만, file: 캡처는 Chrome이 별도 "파일 URL 액세스" 토글을
// 요구하므로 명시적 스킴 체크로 의도적으로 배제한다(navigation 분기는 file:을 만료 폴백 처리).
export function isBroadCoveredUrl(url: string | undefined): boolean {
  if (!url || !isSupportedUrl(url)) return false;
  try {
    return BROAD_COVERED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// 메인 프레임 cross-document 네비게이션 시작 시 호출.
// same-origin이면 패널을 유지하고 stale 세션만 정리한다.
// <all_urls>가 required라 광역 권한은 항상 보유 — cross-origin이라도 새 URL이 광역 커버
// (http/https) 지원 URL이면 same-origin처럼 패널을 유지하고, file: 등 비커버 URL에서만 닫는다.
async function deactivatePanelIfCrossOrigin(
  tabId: number,
  newUrl: string | undefined,
): Promise<void> {
  const key = sessionKey(tabId);
  const urlKey = `${ACTIVATION_URL_PREFIX}${tabId}`;
  try {
    const set = await getActivatedSet();
    if (!set.has(tabId)) return;
    const data = await chrome.storage.session.get(key);
    const snap = data[key] as SessionSnap | undefined;
    const preserved = shouldPreserveSession(snap);

    let refUrl = snap?.target?.url;
    if (!refUrl) {
      const urlData = await chrome.storage.session.get(urlKey);
      refUrl = urlData[urlKey] as string | undefined;
    }
    if (!refUrl) return;

    const oldOrigin = originOf(refUrl);
    const newOrigin = originOf(newUrl);
    const sameOrigin =
      oldOrigin != null && newOrigin != null && oldOrigin === newOrigin;

    // <all_urls>가 required라 광역 권한은 항상 보유 — 분기 판정은 newUrl 커버 여부에만 달림.
    const action = resolveNavigationAction({
      preserved,
      sameOrigin,
      pageKeyChanged: pageKeyOf(refUrl) !== pageKeyOf(newUrl),
      broadGranted: true,
      newUrlBroadCovered: isBroadCoveredUrl(newUrl),
      // newUrl은 onUpdated의 `info.url ?? tab.url`이다. 미지원 URL로의 이동에서도 아이콘 클릭
      // activeTab 그랜트가 살아 있는 동안엔 loading 시점에 값이 실려 온다. 빈 문자열도 판독
      // 불가로 접는다 — isSupportedUrl·originOf·pageKeyOf가 전부 그렇게 취급한다.
      newUrlReadable: Boolean(newUrl),
      newUrlSupported: isSupportedUrl(newUrl),
      prevUrlSupported: isSupportedUrl(refUrl),
    });

    // 패널을 유지하는 분기에서는 기준 URL을 새 URL로 옮긴다. 안 그러면 다음 이동이 여전히
    // 최초 URL을 보고 판정한다 — https → chrome:// → chrome:// 에서 두 번째 이동이
    // prevUrlSupported=true로 읽혀 패널이 닫혔다.
    switch (action) {
      case "keep":
        if (newUrl) await chrome.storage.session.set({ [urlKey]: newUrl });
        return;
      case "clearSession":
        if (newUrl) await chrome.storage.session.set({ [urlKey]: newUrl });
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
        // 기준 URL도 지운다 — 남겨두면 미지원 페이지에서 아이콘을 다시 눌러 패널을 열었을 때
        // activateTab이 URL을 못 읽어 키를 안 쓰므로 stale 값이 그대로 다음 판정에 쓰인다.
        await chrome.storage.session.remove(urlKey);
        return;
      default:
        action satisfies never;
    }
  } catch (err) {
    console.error("[bugshot] deactivatePanelIfCrossOrigin", err);
  }
}

// 미지원 URL에서도 패널을 연다 — sidePanel API엔 URL 제약이 없고(content script 제약과 별개
// 스코프), 패널이 안 열리면 클릭이 무음으로 삼켜져 실패가 100% 제품에 귀속된다. 미지원 여부는
// 패널이 무엇을 그리는지만 결정한다(useTabSupport).
// setOptions·open은 반드시 동기로 유지한다 — await를 끼우면 user gesture가 소실돼 open이
// 조용히 실패한다(docs/ARCHITECTURE.md).
export function activateTab(tab: chrome.tabs.Tab): void {
  if (tab.id == null) return;
  const tabId = tab.id;

  void chrome.sidePanel
    .setOptions({
      tabId,
      path: `${SIDEPANEL_PATH}?tabId=${tabId}`,
      enabled: true,
    })
    .catch((err) => console.error("[bugshot] sidePanel.setOptions", err));
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

    try {
      await chrome.tabs.get(tabId);
    } catch {
      return; // 활성화 직후 탭이 닫힘 — 적용할 게 없음
    }
    try {
      await apply(tabId);
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
      void clearIfPageChanged(tabId, info.url).then(() => apply(tabId));
    } else if (info.status === "complete") {
      void apply(tabId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId, { windowId }) => {
    // 직전 활성 탭 포인터가 닫힌 탭을 가리키면 제거 — 같은 id 재사용 시 무관 탭 stop 방지.
    if (prevActiveTabByWindow.get(windowId) === tabId) {
      prevActiveTabByWindow.delete(windowId);
    }
    void chrome.storage.session.remove([sessionKey(tabId), `${ACTIVATION_URL_PREFIX}${tabId}`]);
    void setActivated(tabId, false);
    deleteNetworkLog(pendingKey(tabId)).catch(() => {});
    deleteConsoleLog(pendingKey(tabId)).catch(() => {});
    deleteActionLog(pendingKey(tabId)).catch(() => {});
    deleteVideoBlob(pendingKey(tabId)).catch(() => {});
  });

  // 윈도우 종료 시 해당 윈도우의 직전 탭 엔트리 정리(누수 방지).
  chrome.windows.onRemoved.addListener((windowId) => {
    prevActiveTabByWindow.delete(windowId);
  });
}
