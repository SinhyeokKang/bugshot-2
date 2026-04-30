import { pageKeyOf, sessionKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import { deleteNetworkLog } from "@/store/blob-db";

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

async function clearEditorSessionIfVolatile(tabId: number): Promise<void> {
  const key = sessionKey(tabId);
  try {
    const data = await chrome.storage.session.get(key);
    const snap = data[key] as
      | { captureMode?: string; phase?: string }
      | undefined;
    if (shouldPreserveSession(snap)) return;
    await chrome.storage.session.remove(key);
  } catch (err) {
    console.error("[bugshot] clearEditorSessionIfVolatile", err);
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
    try {
      const tab = await chrome.tabs.get(tabId);
      await apply(tabId, tab.url);
    } catch (err) {
      console.error("[bugshot] onActivated", err);
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.url) {
      void clearIfPageChanged(tabId, info.url).then(() =>
        apply(tabId, info.url),
      );
    } else if (info.status === "loading") {
      void clearEditorSessionIfVolatile(tabId);
    } else if (info.status === "complete") {
      void apply(tabId, tab.url);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove(sessionKey(tabId));
    void setActivated(tabId, false);
    deleteNetworkLog(`pending:${tabId}`).catch(() => {});
  });
}
