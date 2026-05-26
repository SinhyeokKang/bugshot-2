import { originOf, pageKeyOf, sessionKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import { deleteNetworkLog, deleteConsoleLog } from "@/store/blob-db";

const SIDEPANEL_PATH = "src/sidepanel/index.html";
const ACTIVATED_KEY = "sidePanel:activated";
const ACTIVATION_URL_PREFIX = "sidePanel:url:";

async function getActivatedSet(): Promise<Set<number>> {
  const data = await chrome.storage.session.get(ACTIVATED_KEY);
  const arr = (data[ACTIVATED_KEY] as number[] | undefined) ?? [];
  return new Set(arr);
}

async function setActivated(tabId: number, on: boolean): Promise<void> {
  const set = await getActivatedSet();
  if (on) set.add(tabId);
  else set.delete(tabId);
  await chrome.storage.session.set({ [ACTIVATED_KEY]: Array.from(set) });
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
  const snap = data[key] as { captureMode?: string; phase?: string } | undefined;
  if (shouldPreserveSession(snap)) return;

  if (!(activated && supported)) {
    try {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    } catch (err) {
      console.error("[bugshot] setOptions failed", err);
    }
  }
}

function shouldPreserveSession(
  snap: { captureMode?: string; phase?: string } | undefined,
): boolean {
  if (!snap) return false;
  const mode = snap.captureMode;
  const phase = snap.phase ?? "";
  if (mode === "video") return true;
  if (mode === "screenshot")
    return phase === "drafting" || phase === "previewing" || phase === "done";
  if (mode === "element")
    return phase === "drafting" || phase === "previewing" || phase === "done";
  return false;
}

async function clearIfPageChanged(
  tabId: number,
  newUrl: string | undefined,
): Promise<void> {
  const key = sessionKey(tabId);
  try {
    const data = await chrome.storage.session.get(key);
    const snap = data[key] as
      | { target?: { url?: string }; captureMode?: string; phase?: string }
      | undefined;
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

// 메인 프레임 cross-document 네비게이션 시작 시 호출.
// same-origin이면 패널을 유지하고 stale 세션만 정리, cross-origin이면 패널을 닫는다.
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
    const snap = data[key] as
      | { target?: { url?: string }; captureMode?: string; phase?: string }
      | undefined;
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

    if (sameOrigin) {
      if (!preserved && pageKeyOf(refUrl) !== pageKeyOf(newUrl)) {
        await chrome.storage.session.remove(key);
      }
      return;
    }

    // cross-origin 또는 URL 판별 불가
    if (preserved) {
      chrome.runtime
        .sendMessage({ type: "activeTabExpiredDeferred", tabId })
        .catch(() => {});
      return;
    }

    await setActivated(tabId, false);
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
    await chrome.storage.session.remove(key);
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

export function setupTabBindings(): void {
  chrome.action.onClicked.addListener(activateTab);

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
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
    // 세션만 정리), cross-origin이면 패널 닫기. SPA same-document는 loading 없음.
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

  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove([sessionKey(tabId), `${ACTIVATION_URL_PREFIX}${tabId}`]);
    void setActivated(tabId, false);
    deleteNetworkLog(`pending:${tabId}`).catch(() => {});
    deleteConsoleLog(`pending:${tabId}`).catch(() => {});
  });
}
