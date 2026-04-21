const SUPPORTED_SCHEMES = new Set(["http:", "https:", "file:"]);
const SIDEPANEL_PATH = "src/sidepanel/index.html";

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return SUPPORTED_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

async function apply(tabId: number, url: string | undefined): Promise<void> {
  const enabled = isSupportedUrl(url);
  try {
    if (enabled) {
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

export function setupTabBindings(): void {
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
      void apply(tabId, info.url);
    } else if (info.status === "complete") {
      void apply(tabId, tab.url);
    }
  });
}
