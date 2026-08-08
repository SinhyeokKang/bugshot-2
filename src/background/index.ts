import { t } from "@/i18n";
import { initBgLocale } from "@/i18n/bg-init";
import { PANEL_PORT_PREFIX, sessionKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import { GithubError } from "./github-api";
import { JiraError } from "./jira-api";
import { LinearError } from "./linear-api";
import { NotionError } from "./notion-api";
import { GitlabError } from "./gitlab-api";
import { AsanaError } from "./asana-api";
import { ClickupError } from "./clickup-api";
import { SlackError } from "./slack-api";
import { handleMessage } from "./messages";
import { BG_REQUEST_TYPES } from "./bgRequestTypes";
import { captureEvent } from "./analytics";
import { OAuthError, serializeOAuthError } from "./oauth";
import { pruneOrphanPendingLogsOncePerSession } from "@/lib/pending-log-prune";
import { shouldClearLogs } from "@/lib/navigation-clear";
import type { BgInternalMessage } from "@/types/messages";
import { activateTab, setupTabBindings, shouldPreserveSession, stopRecorders } from "./tab-bindings";
import {
  applyDeviceSignal,
  clearDeviceFrame,
  enqueueForTab,
  getDeviceFrame,
  isTopLikeFrame,
  mayNeedDeviceSignal,
  trackCommittedUrl,
} from "./device-frame-coordinator";

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
//
// 디바이스 뷰포트 모드에서는 **래퍼 frameId를 top처럼 취급한다** — 래퍼가 이동해도 top URL은
// 안 바뀌므로 그대로 두면 래퍼 안의 이동이 이 그물을 통째로 통과해, 같은 조작인데 모드
// ON/OFF에서 로그 범위가 달라진다. 단 그 취급은 **로그 라이프사이클에만** 적용하고
// frameCommitted push는 언제나 실제 frameId로 보낸다(아래 주석 참조).
//
// 키가 `tabId:frameId`인 이유: tabId 단일 키면 top과 래퍼가 겹쳐 navigate할 때 엔트리가
// 서로를 덮는다. 래퍼의 prev URL은 tabs.get이 아니라 직전 onCommitted URL로 추적한다.
const navUrlPromise = new Map<string, Promise<string>>();

function navKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  const { tabId, frameId, parentFrameId, url } = details;
  if (frameId === 0) {
    // prev URL 스냅샷은 동기로 잡는다 — 큐에 넣으면 커밋 뒤에 읽어 새 URL이 prev가 된다.
    navUrlPromise.set(
      navKey(tabId, 0),
      chrome.tabs.get(tabId).then((tab) => tab.url ?? "").catch(() => ""),
    );
  }
  // 디바이스 관여가 없는 탭의 서브프레임 이동은 판정도 로그 꼬리 sync도 대상이 아니다 —
  // 큐에 넣으면 광고 iframe 하나마다 storage 복원 체인과 arm 슬롯 엔트리가 생긴다.
  if (frameId !== 0 && !mayNeedDeviceSignal(tabId)) return;
  void enqueueForTab(tabId, async () => {
    // **판정보다 먼저 본다.** handoff 판정은 binding을 폐기하므로, 뒤에서 읽으면 떠나는 래퍼가
    // top-like가 아니게 돼 그 문서의 로그 꼬리가 통째로 사라진다. 판정을 기다리는 것도
    // 안 된다 — handoff는 ACK 상한만큼 큐를 붙잡는데 그 사이 문서는 이미 갈린다.
    if (isTopLikeFrame(getDeviceFrame(tabId), frameId)) {
      // 발송은 fire-and-forget이라 판정을 기다리게 할 이유가 없다 — storage 왕복까지 앞에
      // 세우면 하필 "commit 전에 잡는" handoff 1차 트리거의 여유를 스스로 깎는다.
      void (async () => {
        const key = sessionKey(tabId);
        const stored = await chrome.storage.session
          .get(key)
          .catch(() => ({}) as Record<string, unknown>);
        if (stored[key] == null) return;
        chrome.tabs.sendMessage(tabId, { type: "networkRecorder.sync" }).catch(() => {});
        chrome.tabs.sendMessage(tabId, { type: "consoleRecorder.sync" }).catch(() => {});
        chrome.tabs.sendMessage(tabId, { type: "actionRecorder.sync" }).catch(() => {});
      })();
    }
    await applyDeviceSignal(tabId, { kind: "beforeNavigate", frameId, parentFrameId, url });
  });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  const { tabId, frameId, documentId, url, transitionType } = details;
  const key = sessionKey(tabId);
  if (frameId === 0) {
    // **큐 밖에서 즉시** 알린다 — 이 push는 사이드패널의 documentId 게이트를 갱신하는
    // 신호라 commit 순서를 지켜야 한다. storage 조회·복원 promise 뒤로 밀리면 새 문서의
    // picker 메시지가 먼저 도착해 정상 메시지가 stale로 드롭된다.
    chrome.runtime
      .sendMessage({ type: "frameCommitted", tabId, frameId: 0, documentId } satisfies BgInternalMessage)
      .catch(() => {});
  }
  void enqueueForTab(tabId, async () => {
    // documentId 없는 커밋(구형 이벤트)은 binding을 만들 수 없어 판정에서 제외한다 —
    // 빈 documentId로 등록하면 문서 열거에서 걸러져 deviceTree가 조용히 빈다.
    // 큐 자체는 못 건너뛴다 — 아래 sentinel 재발행이 디바이스 모드와 무관하게 필요하다.
    if (documentId && mayNeedDeviceSignal(tabId)) {
      await applyDeviceSignal(tabId, { kind: "committed", frameId, documentId, url });
    }
    const binding = getDeviceFrame(tabId);

    if (frameId !== 0) {
      // 캡처 시작 이후 생성·커밋된 iframe: 활성 세션이 있으면 sidepanel에 알려 보유 sentinel을
      // 그 프레임에 재발행 → 정적 주입만으론 못 받는 'broadcast 이후 iframe'을 활성화한다.
      // **래퍼도 이 분기를 그대로 탄다.** 아래 top 분기의 하드코딩 frameId: 0으로 보내면
      // 래퍼 documentId가 0 슬롯에 들어가 이후 진짜 top의 picker.selected/cancelled/
      // areaSelected가 전부 isStalePickerDocument에 걸려 드롭된다(완전 무반응 회귀).
      const stored = await chrome.storage.session.get(key).catch(() => ({}) as Record<string, unknown>);
      if (stored[key] != null) {
        chrome.runtime
          .sendMessage({
            type: "frameCommitted",
            tabId,
            frameId,
            documentId,
          } satisfies BgInternalMessage)
          .catch(() => {});
      }
    }

    // 여기서부터가 로그 라이프사이클 — 래퍼를 top처럼 취급하는 유일한 축이다.
    if (isTopLikeFrame(binding, frameId)) {
      const prev =
        frameId === 0
          ? await (navUrlPromise.get(navKey(tabId, 0)) ?? Promise.resolve(""))
          : trackCommittedUrl(tabId, frameId, url);
      if (frameId === 0) navUrlPromise.delete(navKey(tabId, 0));
      const stored = await chrome.storage.session.get(key).catch(() => ({}) as Record<string, unknown>);
      if (stored[key] != null && shouldClearLogs(prev, url, transitionType)) {
        chrome.runtime
          .sendMessage({ type: "logClear", tabId } satisfies BgInternalMessage)
          .catch(() => {});
      }
    }

    // top 문서가 갈리면 래퍼도 함께 사라진다 — binding을 남기면 다음 판정이 유령 frameId를
    // 래퍼로 취급한다. 재수립은 사이드패널이 pending으로 다시 세운다.
    // 디바이스 관여가 없는 탭은 지울 게 없다 — 무조건 부르면 모든 탭의 top 이동마다
    // storage.session.remove 왕복이 탭 큐 안에서 직렬로 걸린다.
    if (frameId === 0 && mayNeedDeviceSignal(tabId)) await clearDeviceFrame(tabId);
  });
});

// 감시창 안이면 차단(frameBlocked), 밖이면 유지 중 차단이라 handoff와 같은 경로로 top을
// 내보낸다 — 안 하면 모드 유지 중 XFO 사이트에 도달했을 때 백지에 방치된다.
chrome.webNavigation.onErrorOccurred.addListener((details) => {
  const { tabId, frameId, url, error } = details;
  if (!mayNeedDeviceSignal(tabId)) return;
  void enqueueForTab(tabId, () =>
    applyDeviceSignal(tabId, { kind: "errorOccurred", frameId, url, error }),
  );
});

// device.frameReady는 요청/응답이 아니라 push다 — BG_REQUEST_TYPES 화이트리스트가 막고
// (등록 누락으로 Asana가 런타임 전량 차단된 회귀 전례), handleMessage는 sender를 아예 안
// 읽는다. 래퍼 frameId를 sender에서 얻어야 하므로 전용 리스너를 따로 단다.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== "object") return false;
  const tabId = sender.tab?.id;
  if (tabId == null) return false;
  if (message.type === "device.frameReady") {
    const frameId = sender.frameId;
    const documentId = sender.documentId;
    if (frameId == null || frameId === 0 || !documentId) return false;
    // 래퍼는 top의 **직속** 자식이다. 이 확인이 없으면 페이지가 2-depth에 심은 프레임도
    // 래퍼를 자칭할 수 있다(id는 페이지가 붙이는 DOM 속성이고 picker는 all_frames다).
    void enqueueForTab(tabId, async () => {
      const frame = await chrome.webNavigation
        .getFrame({ tabId, frameId })
        .catch(() => null);
      if (frame?.parentFrameId !== 0) return;
      await applyDeviceSignal(tabId, { kind: "frameReady", frameId, documentId });
    });
    return false;
  }
  return false;
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
      } else if (error instanceof GitlabError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.status,
          body: error.body,
        });
      } else if (error instanceof AsanaError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.status,
          body: error.body,
        });
      } else if (error instanceof ClickupError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.status,
          body: error.body,
        });
      } else if (error instanceof SlackError) {
        sendResponse({
          ok: false,
          error: error.message,
          status: error.status,
          body: error.body,
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
