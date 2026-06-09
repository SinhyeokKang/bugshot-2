import type { PickerMessage } from "@/types/picker";
import { postToRuntime } from "./post-to-runtime";

// 모든 프레임(top + iframe)에 주입되는 ISOLATED world 브리지. 자기 프레임의 MAIN world
// 레코더와 CustomEvent로 통신하며, sentinel을 받아 활성화하고 data를 사이드패널로 중계한다.
// picker.ts(top only)와 분리돼 iframe 로그 커버리지를 담당한다.

/* ── Network recorder bridge ──────────────────────── */

let networkSentinel: string | null = null;

function handleNetData(e: Event): void {
  const detail = (e as CustomEvent).detail;
  if (!detail || detail.sentinel !== networkSentinel) return;
  postToRuntime({
    type: "networkRecorder.data",
    payload: {
      requests: detail.requests,
      totalSeen: detail.totalSeen,
      warnings: detail.warnings,
    },
  });
}

function handleSetSentinel(sentinel: string): void {
  if (networkSentinel === sentinel) return;
  if (networkSentinel) {
    document.removeEventListener("__bugshot_net_data__" + networkSentinel, handleNetData);
  }
  networkSentinel = sentinel;
  document.addEventListener("__bugshot_net_data__" + sentinel, handleNetData);
  // MAIN world 레코더에 sentinel 전달 — content_scripts(document_start)로 미리 inject된 레코더를 활성화한다.
  document.dispatchEvent(
    new CustomEvent("__bugshot_net_setSentinel__", { detail: { sentinel } }),
  );
}

function handleNetworkStop(): void {
  if (!networkSentinel) return;
  document.dispatchEvent(new CustomEvent("__bugshot_net_stop__" + networkSentinel));
}

function handleNetworkSync(): void {
  if (!networkSentinel) return;
  document.dispatchEvent(new CustomEvent("__bugshot_net_sync__" + networkSentinel));
}

function handleNetworkClear(): void {
  if (!networkSentinel) return;
  document.dispatchEvent(new CustomEvent("__bugshot_net_clear__" + networkSentinel));
}

/* ── Console recorder bridge ─────────────────────── */

let consoleSentinel: string | null = null;

function handleConsoleData(e: Event): void {
  const detail = (e as CustomEvent).detail;
  if (!detail || detail.sentinel !== consoleSentinel) return;
  postToRuntime({
    type: "consoleRecorder.data",
    payload: {
      entries: detail.entries,
      totalSeen: detail.totalSeen,
    },
  });
}

function handleSetConsoleSentinel(sentinel: string): void {
  if (consoleSentinel === sentinel) return;
  if (consoleSentinel) {
    document.removeEventListener("__bugshot_console_data__" + consoleSentinel, handleConsoleData);
  }
  consoleSentinel = sentinel;
  document.addEventListener("__bugshot_console_data__" + sentinel, handleConsoleData);
  document.dispatchEvent(
    new CustomEvent("__bugshot_console_setSentinel__", { detail: { sentinel } }),
  );
}

function handleConsoleStop(): void {
  if (!consoleSentinel) return;
  document.dispatchEvent(new CustomEvent("__bugshot_console_stop__" + consoleSentinel));
}

function handleConsoleSync(): void {
  if (!consoleSentinel) return;
  document.dispatchEvent(new CustomEvent("__bugshot_console_sync__" + consoleSentinel));
}

function handleConsoleClear(): void {
  if (!consoleSentinel) return;
  document.dispatchEvent(new CustomEvent("__bugshot_console_clear__" + consoleSentinel));
}

/* ── Action recorder bridge ──────────────────────── */

let actionSentinel: string | null = null;

function handleActionData(e: Event): void {
  const detail = (e as CustomEvent).detail;
  if (!detail || detail.sentinel !== actionSentinel) return;
  postToRuntime({
    type: "actionRecorder.data",
    payload: {
      entries: detail.entries,
      totalSeen: detail.totalSeen,
    },
  });
}

function handleSetActionSentinel(sentinel: string): void {
  if (actionSentinel === sentinel) return;
  if (actionSentinel) {
    document.removeEventListener("__bugshot_action_data__" + actionSentinel, handleActionData);
  }
  actionSentinel = sentinel;
  document.addEventListener("__bugshot_action_data__" + sentinel, handleActionData);
  document.dispatchEvent(
    new CustomEvent("__bugshot_action_setSentinel__", { detail: { sentinel } }),
  );
}

function handleActionStop(): void {
  if (!actionSentinel) return;
  document.dispatchEvent(new CustomEvent("__bugshot_action_stop__" + actionSentinel));
}

function handleActionSync(): void {
  if (!actionSentinel) return;
  document.dispatchEvent(new CustomEvent("__bugshot_action_sync__" + actionSentinel));
}

function handleActionClear(): void {
  if (!actionSentinel) return;
  document.dispatchEvent(new CustomEvent("__bugshot_action_clear__" + actionSentinel));
}

// 정적(document_idle all_frames) 주입과 capture 시작 시 programmatic 재주입(picker-control:
// ensureRecorderBridge)이 같은 ISOLATED world에서 모듈을 두 번 평가할 수 있다. 리스너 이중 등록을
// 막는 멱등 가드 — 플래그는 확장 reload 시 ISOLATED world 재생성으로 리셋돼 재주입으로 자가복구된다.
const BRIDGE_FLAG = "__bugshotRecorderBridge__";
if (!(window as any)[BRIDGE_FLAG]) {
  (window as any)[BRIDGE_FLAG] = true;
  registerBridgeListener();
}

function registerBridgeListener(): void {
  chrome.runtime.onMessage.addListener(
    (msg: PickerMessage, _sender, sendResponse) => {
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;
      try {
        switch (msg.type) {
          case "networkRecorder.setSentinel":
            handleSetSentinel(msg.sentinel);
            break;
          case "networkRecorder.stop":
            handleNetworkStop();
            break;
          case "networkRecorder.sync":
            handleNetworkSync();
            break;
          case "networkRecorder.clear":
            handleNetworkClear();
            break;
          case "consoleRecorder.setSentinel":
            handleSetConsoleSentinel(msg.sentinel);
            break;
          case "consoleRecorder.stop":
            handleConsoleStop();
            break;
          case "consoleRecorder.sync":
            handleConsoleSync();
            break;
          case "consoleRecorder.clear":
            handleConsoleClear();
            break;
          case "actionRecorder.setSentinel":
            handleSetActionSentinel(msg.sentinel);
            break;
          case "actionRecorder.stop":
            handleActionStop();
            break;
          case "actionRecorder.sync":
            handleActionSync();
            break;
          case "actionRecorder.clear":
            handleActionClear();
            break;
          // picker.* 등 그 외 메시지는 picker.ts(top only)가 처리 — 무응답으로 흘려 이중 응답 방지.
          default:
            return;
        }
        sendResponse({ ok: true });
      } catch (err) {
        console.error("[bugshot] recorder bridge handler error", msg.type, err);
        sendResponse({ ok: false, error: String(err) });
      }
    },
  );
}
