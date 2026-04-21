const SUPPORTED_SCHEMES = new Set(["http:", "https:", "file:"]);
const SIDEPANEL_PATH = "src/sidepanel/index.html";
const ACTIVATED_KEY = "sidePanel:activated";

function sessionKey(tabId: number): string {
  return `editor:${tabId}`;
}

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return SUPPORTED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function pageKeyOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

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
  try {
    if (activated && supported) {
      await chrome.sidePanel.setOptions({
        tabId,
        path: `${SIDEPANEL_PATH}?tabId=${tabId}`,
        enabled: true,
      });
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    }
  } catch (err) {
    console.error("[bugshot] setOptions failed", err);
  }
}

async function clearIfPageChanged(
  tabId: number,
  newUrl: string | undefined,
): Promise<void> {
  const key = sessionKey(tabId);
  try {
    const data = await chrome.storage.session.get(key);
    const snap = data[key] as { target?: { url?: string } } | undefined;
    const prevUrl = snap?.target?.url;
    if (!prevUrl) return;
    if (pageKeyOf(prevUrl) !== pageKeyOf(newUrl)) {
      await chrome.storage.session.remove(key);
    }
  } catch (err) {
    console.error("[bugshot] clearIfPageChanged", err);
  }
}

export function setupTabBindings(): void {
  chrome.action.onClicked.addListener((tab) => {
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
  });

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
      void clearIfPageChanged(tabId, info.url);
      void apply(tabId, info.url);
    } else if (info.status === "complete") {
      void apply(tabId, tab.url);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.session.remove(sessionKey(tabId));
    void setActivated(tabId, false);
  });
}
