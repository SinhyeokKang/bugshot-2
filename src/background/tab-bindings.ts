import { pageKeyOf, sessionKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import { deleteNetworkLog, deleteConsoleLog } from "@/store/blob-db";

const SIDEPANEL_PATH = "src/sidepanel/index.html";
const ACTIVATED_KEY = "sidePanel:activated";

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

// 메인 프레임 cross-document 네비게이션 시작 시 호출. 보존 상태가 아니면 패널을 닫고 비활성화해
// 1.2.0과 동일하게 "재오픈(아이콘 클릭) 시 activeTab 재취득"을 강제한다. 광역 권한이 있으면
// info.url이 읽혀 apply가 supported=true로 패널을 유지해 버리므로, url 가독성에 의존하지 않도록
// status 기반으로 트리거하고 setActivated(false)로 직후 apply의 재활성화를 막는다.
async function deactivatePanelIfVolatile(tabId: number): Promise<void> {
  const key = sessionKey(tabId);
  try {
    const set = await getActivatedSet();
    if (!set.has(tabId)) return; // 패널이 붙은 탭만 대상
    const data = await chrome.storage.session.get(key);
    const snap = data[key] as
      | { captureMode?: string; phase?: string }
      | undefined;
    if (shouldPreserveSession(snap)) return; // 보존 상태 → 패널 유지
    await setActivated(tabId, false);
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
    await chrome.storage.session.remove(key);
  } catch (err) {
    console.error("[bugshot] deactivatePanelIfVolatile", err);
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
    // cross-document 네비게이션 시작(status loading)은 광역 권한 유무와 무관하게 활성 탭에서
    // activeTab을 만료시킨다. 비보존 상태면 패널을 닫아 1.2.0 동작을 복원한다. info.url이 함께
    // 와도 status를 먼저 보고 분기해 apply의 재활성화를 피한다. (SPA same-document는 loading 없음)
    if (info.status === "loading") {
      void deactivatePanelIfVolatile(tabId);
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
    void chrome.storage.session.remove(sessionKey(tabId));
    void setActivated(tabId, false);
    deleteNetworkLog(`pending:${tabId}`).catch(() => {});
    deleteConsoleLog(`pending:${tabId}`).catch(() => {});
  });
}
