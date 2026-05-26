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

// 떠나는 페이지의 로그 꼬리 보존(주 경로). 메인 프레임 네비게이션 커밋 직전에 해당 탭의 MAIN
// 버퍼를 sync해 사이드패널 누적기로 넘긴다. 패널이 바인딩된 탭(editor:${tabId} 세션 키 존재)에만
// 보내 무관 탭으로의 낭비 메시지를 막는다 — 세션 스토리지는 SW 재시작에도 유지돼 가드가 안전.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  const key = sessionKey(details.tabId);
  void chrome.storage.session.get(key).then((stored) => {
    if (stored[key] == null) return;
    chrome.tabs
      .sendMessage(details.tabId, { type: "networkRecorder.sync" })
      .catch(() => {});
    chrome.tabs
      .sendMessage(details.tabId, { type: "consoleRecorder.sync" })
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
