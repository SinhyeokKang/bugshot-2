import { t } from "@/i18n";
import { initBgLocale } from "@/i18n/bg-init";
import { JiraError } from "./jira-api";
import { handleMessage } from "./messages";
import { OAuthError } from "./oauth";
import { activateTab, setupTabBindings } from "./tab-bindings";

initBgLocale();

function friendlyError(error: unknown): string {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return t("bg.error.network");
  }
  return error instanceof Error ? error.message : String(error);
}

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

async function getActionShortcut(): Promise<string> {
  try {
    const cmds = await chrome.commands.getAll();
    return cmds.find((c) => c.name === "_execute_action")?.shortcut ?? "";
  } catch {
    return "";
  }
}

async function setupContextMenu(): Promise<void> {
  const shortcut = await getActionShortcut();
  const base = chrome.i18n.getMessage("EXT_NAME_SHORT");
  const title = shortcut ? `${base} — ${shortcut}` : base;
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "bugshot-activate",
    title,
    contexts: ["page"],
  });
}

chrome.runtime.onInstalled.addListener(() => {
  disableGlobalSidePanel();
  void setupContextMenu();
});
chrome.runtime.onStartup.addListener(() => {
  disableGlobalSidePanel();
  void setupContextMenu();
});

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
      } else if (error instanceof OAuthError) {
        const cancelled = /cancel|취소|not authorize|not approve/i.test(error.message);
        sendResponse({
          ok: false,
          error: error.message,
          status: cancelled ? undefined : 401,
          body: cancelled ? undefined : { oauthRefreshFailed: true },
        });
      } else {
        sendResponse({ ok: false, error: friendlyError(error) });
      }
    });
  return true;
});
