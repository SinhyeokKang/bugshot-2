import { t } from "@/i18n";
import { initBgLocale } from "@/i18n/bg-init";
import {
  CAPTURE_SHORTCUT_MSG,
  CAPTURE_COMMANDS,
  type CaptureCommand,
} from "@/lib/capture-commands";
import { PANEL_PORT_PREFIX, sessionKey } from "@/lib/session-keys";
import { GithubError } from "./github-api";
import { JiraError } from "./jira-api";
import { LinearError } from "./linear-api";
import { NotionError } from "./notion-api";
import { handleMessage } from "./messages";
import { OAuthError } from "./oauth";
import { pruneOrphanPendingLogsOncePerSession } from "@/lib/pending-log-prune";
import { shouldClearLogs } from "@/lib/navigation-clear";
import type { BgInternalMessage } from "@/types/messages";
import { activateTab, setupTabBindings } from "./tab-bindings";

initBgLocale();
void pruneOrphanPendingLogsOncePerSession();

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
  "jira.getTransitions",
  "jira.transitionIssue",
  "jira.searchEpics",
  "jira.submitIssue",
  "github.oauth.available",
  "github.startOAuth",
  "github.testPat",
  "github.disconnect",
  "github.getMyself",
  "github.searchRepos",
  "github.getLabels",
  "github.searchAssignees",
  "github.uploadFiles",
  "github.submitIssue",
  "github.getIssueStatus",
  "github.updateIssueState",
  "linear.oauth.available",
  "linear.startOAuth",
  "linear.testApiKey",
  "linear.disconnect",
  "linear.getMyself",
  "linear.getTeams",
  "linear.getProjects",
  "linear.getLabels",
  "linear.getMembers",
  "linear.submitIssue",
  "linear.uploadFile",
  "linear.createAttachment",
  "linear.getIssueStatus",
  "linear.getWorkflowStates",
  "linear.updateIssueState",
  "notion.oauth.available",
  "notion.startOAuth",
  "notion.testToken",
  "notion.disconnect",
  "notion.getMyself",
  "notion.searchDatabases",
  "notion.getDatabaseSchema",
  "notion.uploadFile",
  "notion.submitPage",
  "notion.getPageStatus",
  "notion.updatePageStatus",
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

let contextMenuSetup: Promise<void> = Promise.resolve();

function setupContextMenu(): Promise<void> {
  // 직렬화: onInstalled/onStartup 동시 발화 시 removeAll/create 인터리브로
  // "duplicate id" 에러가 나는 것을 막는다.
  contextMenuSetup = contextMenuSetup.then(async () => {
    const shortcut = await getActionShortcut();
    const base = chrome.i18n.getMessage("EXT_NAME_SHORT");
    const title = shortcut ? `${base} — ${shortcut}` : base;
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: "bugshot-activate",
      title,
      contexts: ["page"],
    });
  }).catch((err) => console.error("[bugshot] context menu setup failed", err));
  return contextMenuSetup;
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

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(PANEL_PORT_PREFIX)) return;
  const tabId = Number(port.name.slice(PANEL_PORT_PREFIX.length));
  if (Number.isNaN(tabId)) return;
  port.onDisconnect.addListener(() => {
    chrome.storage.session.remove(sessionKey(tabId)).catch(() => {});
    chrome.tabs.sendMessage(tabId, { type: "picker.clear" }).catch(() => {});
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!(CAPTURE_COMMANDS as readonly string[]).includes(command)) return;
  if (tab?.id == null) return;
  chrome.runtime
    .sendMessage({
      type: CAPTURE_SHORTCUT_MSG,
      command: command as CaptureCommand,
      tabId: tab.id,
    })
    .catch(() => {});
});

// --- 네비게이션 로그 관리 ---
// onBeforeNavigate: 떠나는 페이지의 MAIN 버퍼를 sync해 사이드패널에 넘긴다.
// onCommitted: cross-origin 또는 reload이면 사이드패널 로그를 초기화(DevTools UX).
//              same-origin 내부 이동은 로그를 보존해 멀티페이지 디버깅에 활용.
const navUrlPromise = new Map<number, Promise<string>>();

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  navUrlPromise.set(
    details.tabId,
    chrome.tabs.get(details.tabId).then((tab) => tab.url ?? "").catch(() => ""),
  );
  const key = sessionKey(details.tabId);
  void chrome.storage.session.get(key).then((stored) => {
    if (stored[key] == null) return;
    chrome.tabs
      .sendMessage(details.tabId, { type: "networkRecorder.sync" })
      .catch(() => {});
    chrome.tabs
      .sendMessage(details.tabId, { type: "consoleRecorder.sync" })
      .catch(() => {});
    chrome.tabs
      .sendMessage(details.tabId, { type: "actionRecorder.sync" })
      .catch(() => {});
  });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const urlPromise = navUrlPromise.get(details.tabId);
  navUrlPromise.delete(details.tabId);
  const key = sessionKey(details.tabId);
  void Promise.all([
    urlPromise ?? Promise.resolve(""),
    chrome.storage.session.get(key),
  ]).then(([prev, stored]) => {
    if (stored[key] == null) return;
    if (!shouldClearLogs(prev, details.url, details.transitionType)) return;
    chrome.runtime
      .sendMessage({ type: "logClear", tabId: details.tabId } satisfies BgInternalMessage)
      .catch(() => {});
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
      } else if (error instanceof GithubError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.status,
          body: error.body,
        });
      } else if (error instanceof LinearError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.status,
          body: error.body,
        });
      } else if (error instanceof NotionError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.status,
          body: error.body,
        });
      } else if (error instanceof OAuthError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.cancelled ? undefined : 401,
          body: error.cancelled
            ? { oauthCancelled: true, platform: error.platform }
            : { oauthRefreshFailed: true, platform: error.platform },
        });
      } else {
        sendResponse({ ok: false, error: friendlyError(error) });
      }
    });
  return true;
});
