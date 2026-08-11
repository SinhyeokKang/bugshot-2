import { t } from "@/i18n";
import { initBgLocale } from "@/i18n/bg-init";
import { PANEL_PORT_PREFIX, sessionKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import { handleMessage } from "./messages";
import { BG_REQUEST_TYPES } from "./bgRequestTypes";
import { serializePlatformError } from "./platformErrors";
import { captureEvent } from "./analytics";
import { OAuthError, serializeOAuthError } from "./oauth";
import { pruneOrphanPendingLogsOncePerSession } from "@/lib/pending-log-prune";
import { shouldClearLogs } from "@/lib/navigation-clear";
import type { BgInternalMessage } from "@/types/messages";
import { activateTab, setupTabBindings, shouldPreserveSession, stopRecorders } from "./tab-bindings";

initBgLocale();
void pruneOrphanPendingLogsOncePerSession();

function friendlyError(error: unknown): string {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return t("bg.error.network");
  }
  return error instanceof Error ? error.message : String(error);
}

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

chrome.runtime.onInstalled.addListener((details) => {
  disableGlobalSidePanel();
  void setupContextMenu();
  if (details.reason === "install") {
    void captureEvent("extension_installed", {
      version: chrome.runtime.getManifest().version,
    });
  }
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
  void chrome.tabs
    .get(tabId)
    .then((tab) => isSupportedUrl(tab.url))
    .catch(() => false)
    .then((supported) =>
      captureEvent("sidepanel_opened", { page_supported: String(supported) }),
    );
  port.onDisconnect.addListener(() => {
    // 보존 phase(drafting/previewing/done/video)는 패널을 닫았다 열어도 복원돼야 하므로
    // 세션·picker 상태를 남긴다 (tab-bindings의 phase별 보존 정책과 동일 기준).
    const key = sessionKey(tabId);
    chrome.storage.session
      .get(key)
      .then((data) => {
        const snap = data[key] as
          | { captureMode?: string; phase?: string }
          | undefined;
        if (shouldPreserveSession(snap)) return;
        chrome.storage.session.remove(key).catch(() => {});
        chrome.tabs.sendMessage(tabId, { type: "picker.clear" }).catch(() => {});
      })
      .catch(() => {});
    stopRecorders(tabId);
  });
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
  }).catch(() => {});
});

chrome.webNavigation.onCommitted.addListener((details) => {
  const key = sessionKey(details.tabId);
  if (details.frameId !== 0) {
    // 캡처 시작 이후 생성·커밋된 iframe: 활성 세션이 있으면 sidepanel에 알려 보유 sentinel을
    // 그 프레임에 재발행 → 정적 주입만으론 못 받는 'broadcast 이후 iframe'을 활성화한다.
    void chrome.storage.session
      .get(key)
      .then((stored) => {
        if (stored[key] == null) return;
        chrome.runtime
          .sendMessage({
            type: "frameCommitted",
            tabId: details.tabId,
            frameId: details.frameId,
            documentId: details.documentId,
          } satisfies BgInternalMessage)
          .catch(() => {});
      })
      .catch(() => {});
    return;
  }
  // top navigation도 이전 document에서 큐잉된 picker lifecycle을 documentId gate로
  // 차단해야 한다. storage 조회를 기다리지 않고 commit 순서대로 먼저 알린다.
  chrome.runtime
    .sendMessage({
      type: "frameCommitted",
      tabId: details.tabId,
      frameId: 0,
      documentId: details.documentId,
    } satisfies BgInternalMessage)
    .catch(() => {});
  const urlPromise = navUrlPromise.get(details.tabId);
  navUrlPromise.delete(details.tabId);
  void Promise.all([
    urlPromise ?? Promise.resolve(""),
    chrome.storage.session.get(key),
  ]).then(([prev, stored]) => {
    if (stored[key] == null) return;
    if (!shouldClearLogs(prev, details.url, details.transitionType)) return;
    chrome.runtime
      .sendMessage({ type: "logClear", tabId: details.tabId } satisfies BgInternalMessage)
      .catch(() => {});
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !BG_REQUEST_TYPES.has(message.type)) return false;

  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => {
      // 플랫폼 에러 8종은 satisfies로 컴파일 강제되는 테이블 한 곳에서 판정한다.
      // OAuth 분기가 반드시 뒤에 와야 한다 — serializePlatformError가 OAuthError에
      // null을 돌려주는 것도 이 순서를 전제로 한 계약이다.
      const platform = serializePlatformError(error);
      if (platform) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          status: platform.status,
          body: platform.body,
        });
      } else if (error instanceof OAuthError) {
        const { status, body } = serializeOAuthError(error);
        sendResponse({ ok: false, error: error.message, status, body });
      } else {
        sendResponse({ ok: false, error: friendlyError(error) });
      }
    });
  return true;
});
