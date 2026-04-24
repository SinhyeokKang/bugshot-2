import { JiraError } from "./jira-api";
import { handleMessage } from "./messages";
import { activateTab, setupTabBindings } from "./tab-bindings";

const BG_REQUEST_TYPES = new Set([
  "ping",
  "captureVisibleTab",
  "oauth.start",
  "oauth.available",
  "jira.myself",
  "jira.listProjects",
  "jira.listIssueTypes",
  "jira.listPriorities",
  "jira.searchUsers",
  "jira.getIssueStatus",
  "jira.searchEpics",
  "jira.submitIssue",
]);

function disableGlobalSidePanel(): void {
  chrome.sidePanel
    .setOptions({ enabled: false })
    .catch((err) => console.error("[bugshot] global disable failed", err));
}

chrome.runtime.onInstalled.addListener(() => {
  disableGlobalSidePanel();
  chrome.contextMenus.create({
    id: "bugshot-activate",
    title: chrome.i18n.getMessage("EXT_NAME"),
    contexts: ["page"],
  });
});
chrome.runtime.onStartup.addListener(disableGlobalSidePanel);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "bugshot-activate" && tab) activateTab(tab);
});

setupTabBindings();

const PANEL_PORT_PREFIX = "bugshot-panel:";
chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(PANEL_PORT_PREFIX)) return;
  const tabId = Number(port.name.slice(PANEL_PORT_PREFIX.length));
  if (Number.isNaN(tabId)) return;
  port.onDisconnect.addListener(() => {
    chrome.storage.session.remove(`editor:${tabId}`).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !BG_REQUEST_TYPES.has(message.type)) return false;

  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => {
      if (error instanceof JiraError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.status,
          body: error.body,
        });
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        sendResponse({ ok: false, error: msg });
      }
    });
  return true;
});
