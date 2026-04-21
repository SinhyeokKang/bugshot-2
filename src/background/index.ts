import { JiraError } from "./jira-api";
import { handleMessage } from "./messages";
import { activateTab, setupTabBindings } from "./tab-bindings";

const BG_REQUEST_TYPES = new Set([
  "ping",
  "captureVisibleTab",
  "jira.myself",
  "jira.listProjects",
  "jira.listIssueTypes",
  "jira.listPriorities",
  "jira.searchUsers",
  "jira.searchEpics",
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
