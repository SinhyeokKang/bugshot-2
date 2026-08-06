import { create } from "zustand";
import { toast } from "sonner";
import { t } from "@/i18n";
import { useEditorStore } from "@/store/editor-store";
import { useSettingsUiStore } from "@/store/settings-ui-store";
import { sendBg, type BgInternalMessage } from "@/types/messages";
import type { PickerMessage } from "@/types/picker";
import {
  activateRecordersInDeviceTree,
  deviceSet,
  deviceState,
  deviceWatch,
  restartPickerInFrame,
  syncAndSettleLogs,
} from "./picker-control";
import {
  networkLogPersist,
  consoleLogPersist,
  actionLogPersist,
} from "./hooks/usePickerMessages";
import { isPresetAvailable } from "./lib/device-presets";
import {
  decideReestablish,
  dropPending,
  noteReestablish,
  putPending,
  resetLoopGuard,
  resolveSelectPath,
  takePending,
} from "./lib/device-mode";

/**
 * 디바이스 뷰포트 모드의 오케스트레이션. **모듈 스코프 단일 인스턴스다** — `useDeviceViewport`가
 * `DeviceViewportBar`와 `App.tsx`의 다이얼로그 분기에서 두 번 마운트되므로, 훅 인스턴스가
 * 오케스트레이션을 소유하면 top 커밋 한 번에 재수립이 2회 발사되고 루프 임계를 각각 절반씩 센다.
 * 사이드패널 문서는 탭 하나에 바인딩되므로 싱글턴이 곧 탭 스코프다.
 */
interface DeviceViewportSnapshot {
  tabId: number | null;
  width: number | null;
  availableWidth: number | null;
  busy: boolean;
  /** 최초 ON 진입 1회 확인 다이얼로그가 대기 중인 폭. null이면 안 띄운다. */
  warningWidth: number | null;
  loopWarning: boolean;
  /** 세션 만료 다이얼로그가 handoff 때문에 떴는가 — body 문구만 가른다. */
  expiredByHandoff: boolean;
}

export const useDeviceViewportStore = create<DeviceViewportSnapshot>(() => ({
  tabId: null,
  width: null,
  availableWidth: null,
  busy: false,
  warningWidth: null,
  loopWarning: false,
  expiredByHandoff: false,
}));

const VERDICT_TIMEOUT_MS = 3000;

let subscribers = 0;
let listening = false;
/** handoff는 "실패"가 아니라 "top이 옮겨간다"다 — 롤백을 돌리면 방금 세운 pending을 지운다. */
type Verdict = { ok: true; frameId: number } | { ok: false; handoff?: boolean };

let verdictWaiter:
  | { resolve: (v: Verdict) => void; timer: ReturnType<typeof setTimeout> }
  | null = null;

function set(patch: Partial<DeviceViewportSnapshot>): void {
  useDeviceViewportStore.setState(patch);
}

function snap(): DeviceViewportSnapshot {
  return useDeviceViewportStore.getState();
}

/* ── 로그 경계 ──────────────────────────────────────────────── */

// 모드 전환은 네비게이션이 아니라 logClear가 안 온다 — 강제한다. store clear가 IDB의 pending
// 로그를 delete하므로 대기 중 throttle write를 먼저 폐기해 stale 버퍼 부활을 막는다.
function clearLogStores(tabId: number): void {
  networkLogPersist.discard();
  consoleLogPersist.discard();
  actionLogPersist.discard();
  const store = useEditorStore.getState();
  store.clearNetworkLog(tabId);
  store.clearConsoleLog(tabId);
  store.clearActionLog(tabId);
}

/* ── background 왕복 ────────────────────────────────────────── */

async function arm(tabId: number, on: boolean): Promise<void> {
  try {
    await sendBg({ type: "device.arm", tabId, on });
  } catch {
    // background 미가동 — 판정이 안 오면 아래 타임아웃이 차단으로 접는다.
  }
}

/** frameLoaded / frameBlocked 중 하나를 기다린다. 무신호면 차단으로 접는다. */
function waitForVerdict(): Promise<Verdict> {
  // 앞선 대기를 먼저 끊는다 — 덮어쓰기만 하면 그 promise가 영영 안 풀려 busy가 굳는다.
  settleVerdict({ ok: false });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      verdictWaiter = null;
      resolve({ ok: false });
    }, VERDICT_TIMEOUT_MS);
    verdictWaiter = { resolve, timer };
  });
}

function settleVerdict(result: Verdict): void {
  const waiter = verdictWaiter;
  if (!waiter) return;
  verdictWaiter = null;
  clearTimeout(waiter.timer);
  waiter.resolve(result);
}

/* ── 전이 ──────────────────────────────────────────────────── */

async function rollbackToFull(tabId: number, message: string): Promise<void> {
  dropPending(tabId);
  await deviceSet(tabId, null);
  set({ width: null });
  toast.error(message);
}

/**
 * `frameLoaded` 확정 뒤의 공통 마무리 — 레코더 전환과 picker 재등록.
 *
 * **picker.start 재시도가 여기 있는 이유**: `picker.start`는 broadcast 1회뿐이라 이후 생성된
 * 프레임에 절대 도달하지 않고, `ensureContentScript`의 ping은 frameId 0만 보므로 자가복구도
 * 안 걸린다. 등록에 실패하면 래퍼가 registry를 통과 못 해 **모드 ON에서 아무 요소도 못 고른다**.
 * broadcast는 절대 쓰지 않는다 — setFrameToken이 picker.start마다 childFrames WeakSet을
 * 갈아치우므로 broadcast하면 방금 등록된 래퍼가 날아간다.
 */
async function finishActivation(tabId: number, frameId: number): Promise<boolean> {
  const ok = await activateRecordersInDeviceTree(tabId, () => clearLogStores(tabId));
  if (useEditorStore.getState().phase === "picking" && frameId !== 0) {
    void restartPickerInFrame(tabId, frameId);
  }
  return ok;
}

export async function selectDeviceWidth(width: number | null): Promise<void> {
  const state = snap();
  const tabId = state.tabId;
  if (tabId == null) return;
  if (isLocked() || state.busy) return; // 카운터도 안 건드린다

  // 사용자 조작이 "정상 사용 중" 신호다.
  resetLoopGuard(tabId);

  // 버튼이 이미 막지만 오케스트레이터 쪽 이중 방어 — Radix는 aria-disabled를 동작 가드로
  // 해석하지 않으므로 키보드 활성화가 여기까지 샐 수 있다.
  if (width != null && !isPresetAvailable(width, state.availableWidth)) return;

  const path = resolveSelectPath(state.width, width);
  if (path === "noop") return;

  // OFF는 unmount + location.reload()인데 그 reload도 top 커밋이라, pending이 남아 있으면
  // 곧바로 재수립이 걸려 OFF↔ON 무한 루프가 된다. 폐기가 device.set보다 앞이어야 한다.
  // (noop을 이미 걸렀으므로 width === null은 곧 on-to-off다.)
  if (path === "on-to-off" || width == null) {
    dropPending(tabId);
    set({ busy: true });
    const res = await deviceSet(tabId, null);
    set({ busy: false, width: res?.width ?? null, availableWidth: res?.available.width ?? state.availableWidth });
    return;
  }

  // 폭 갱신은 재로드가 없어 frameReady도 onCommitted도 오지 않는다 — arm·판정 대기·레코더
  // 전환·로그 clear를 붙이면 3초 무신호 → 차단 판정 → 롤백으로 모드가 통째로 풀린다.
  if (path === "resize") {
    set({ busy: true });
    const res = await deviceSet(tabId, width);
    set({ busy: false });
    if (!res?.ok) {
      await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    set({ width: res.width, availableWidth: res.available.width });
    putPending(tabId, width);
    return;
  }

  // OFF→ON: 최초 진입이면 경고를 먼저 소비한다(다이얼로그 [계속]이 runOffToOn을 잇는다).
  if (!useSettingsUiStore.getState().deviceModeWarned) {
    set({ warningWidth: width });
    return;
  }
  await runOffToOn(tabId, width);
}

async function runOffToOn(tabId: number, width: number): Promise<void> {
  set({ busy: true });
  try {
    // 떠나는 페이지 로그 꼬리를 누적기에 밀어넣는다.
    await syncAndSettleLogs(tabId);
    // device.set보다 먼저 열어야 첫 onBeforeNavigate를 안 놓친다.
    await arm(tabId, true);
    const res = await deviceSet(tabId, width);
    // undefined(전달 실패)와 {ok:false}(마운트 실패)를 구분해서 다뤄야 한다 — ok === false만
    // 보면 send가 실패를 undefined로 삼키므로 전달 실패가 성공으로 샌다.
    if (!res?.ok) {
      await arm(tabId, false);
      await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    set({ width: res.width, availableWidth: res.available.width });

    const verdict = await waitForVerdict();
    await arm(tabId, false);
    if (!verdict.ok) {
      // handoff면 top이 이미 옮겨가는 중이라 롤백하지 않는다 — 재수립이 뒤를 잇는다.
      if (!verdict.handoff) await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    const activated = await finishActivation(tabId, verdict.frameId);
    if (!activated) {
      await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    putPending(tabId, width);
  } finally {
    set({ busy: false });
  }
}

/**
 * 재수립. **사용자 조작이 아니라 "이미 벌어진 페이지 사실"에 대한 반응이다.**
 * 호출 지점은 둘뿐 — ① top onCommitted + pending 있음 ② 패널 마운트 시 binding 엇갈림.
 * handoff·차단 복구는 pending을 세팅하고 top을 옮기기만 하며 직접 부르지 않는다.
 */
async function reestablish(tabId: number, width: number, url: string): Promise<void> {
  // 게이트를 먼저 본다 — 거부된 시도까지 세면 busy가 겹칠 때 루프 임계가 헛되이 오른다.
  const gate = decideReestablish({
    phase: useEditorStore.getState().phase,
    unsupported: unsupportedTab,
    busy: snap().busy,
    loop: false,
  });
  if (gate.action === "reject") {
    // busy 거부는 실패가 아니다 — 되돌려놓지 않으면 select()가 도는 중에 온 top 커밋에서
    // 모드가 조용히 유실된다.
    putPending(tabId, width);
    return;
  }
  if (gate.action === "abandon") {
    dropPending(tabId);
    set({ width: null });
    return;
  }
  if (noteReestablish(tabId, url) === "loop") {
    dropPending(tabId);
    set({ width: null, loopWarning: true });
    return;
  }

  set({ busy: true });
  try {
    // 재수립은 syncAndSettleLogs를 안 한다 — 떠나는 문서가 이미 없다. 1회 경고도 안 띄운다.
    await arm(tabId, true);
    const res = await deviceSet(tabId, width);
    if (!res?.ok) {
      await arm(tabId, false);
      await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    set({ width: res.width, availableWidth: res.available.width });

    const loaded = await waitForVerdict();
    await arm(tabId, false);
    if (!loaded.ok) {
      if (!loaded.handoff) await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    // stop ACK 뒤 clear를 무조건 한 번 한다 — background의 logClear는 editor 세션 스냅샷이
    // 있을 때만 발화해서, 패널을 막 열고 첫 로그 전이면 안 돈다. 두 번 비워도 둘 다
    // start ACK 전이라 무해하다.
    const activated = await finishActivation(tabId, loaded.frameId);
    if (!activated) {
      await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    putPending(tabId, width);
  } finally {
    set({ busy: false });
  }
}

/* ── push 수신 ─────────────────────────────────────────────── */

// 다이얼로그 마운트 지점이 없는 phase — 통보를 토스트 1개로 갈음한다.
const TOAST_ONLY_PHASES = new Set(["recording", "previewing", "done"]);

async function onHandoff(tabId: number, url: string): Promise<void> {
  // handoff는 재수립을 직접 하지 않는다 — pending을 세팅하고 top을 옮기는 것까지가 책임이고,
  // 실제 재수립은 top onCommitted 한 지점이 맡는다.
  const width = snap().width;
  if (width == null) return;
  // 진행 중인 select의 판정 대기를 handoff로 끊는다 — 평범한 실패로 끊으면 그 select가
  // 롤백을 돌려 아래에서 세울 pending을 먼저 지운다.
  settleVerdict({ ok: false, handoff: true });
  // 열린 채 남은 3초 창이 타임아웃되면 frameBlocked가 뒤늦게 날아와 방금 성공한 재수립을
  // 롤백시킨다 — tabs.update 전에 반드시 닫는다.
  await arm(tabId, false);
  putPending(tabId, width);
  try {
    await chrome.tabs.update(tabId, { url });
  } catch {
    // 탭이 닫혔다 — pending은 다음 마운트에서 폐기된다.
    return;
  }
  const phase = useEditorStore.getState().phase;
  if (TOAST_ONLY_PHASES.has(phase)) {
    toast.info(t("issue.device.handoffToast"));
    return;
  }
  // phase 판정 없이 무조건 켠다 — 렌더 분기가 non-idle 셋뿐이라 idle에서는 안 뜬다.
  set({ expiredByHandoff: true });
  useEditorStore.setState({ sessionExpired: true });
}

function handleMessage(message: unknown, sender: chrome.runtime.MessageSender): void {
  if (!message || typeof message !== "object" || !("type" in message)) return;
  const tabId = snap().tabId;
  if (tabId == null) return;
  const msg = message as BgInternalMessage | PickerMessage;

  if (msg.type === "device.availableChanged") {
    if (sender.tab?.id !== tabId) return;
    set({ availableWidth: msg.available.width });
    return;
  }
  if (msg.type === "device.frameLoaded") {
    if (msg.tabId !== tabId) return;
    settleVerdict({ ok: true, frameId: msg.frameId });
    return;
  }
  if (msg.type === "device.frameBlocked") {
    if (msg.tabId !== tabId) return;
    settleVerdict({ ok: false });
    return;
  }
  if (msg.type === "device.handoff") {
    if (msg.tabId !== tabId) return;
    void onHandoff(tabId, msg.url);
    return;
  }
  if (msg.type === "frameCommitted") {
    if (msg.tabId !== tabId || msg.frameId !== 0) return;
    // 소비 즉시 삭제한 뒤 재수립하고, 성공하면 다시 세팅한다(실패 경로에 유령 pending이 안 남게).
    const pending = takePending(tabId);
    if (!pending) return;
    void chrome.tabs
      .get(tabId)
      .then((tab) => reestablish(tabId, pending.width, tab.url ?? ""))
      .catch(() => {});
  }
}

/* ── 구독 ──────────────────────────────────────────────────── */

// 미지원 판정은 훅이 알려준다 — 컨트롤러가 chrome.tabs를 또 폴링하지 않는다.
let unsupportedTab = false;

export function setDeviceViewportUnsupported(value: boolean): void {
  unsupportedTab = value;
  if (value) {
    const tabId = snap().tabId;
    if (tabId != null) dropPending(tabId);
  }
}

function isLocked(): boolean {
  return useEditorStore.getState().phase !== "idle" || unsupportedTab;
}

async function syncFromPage(tabId: number): Promise<void> {
  const state = await deviceState(tabId);
  if (snap().tabId !== tabId) return;
  set({ width: state?.width ?? null, availableWidth: state?.available.width ?? null });
  if (state?.width == null) return;
  // 페이지엔 래퍼가 있는데 binding이 없다 = 확장 reload로 storage.session이 비워진 상태.
  // 살아 있는 스크립트가 없어 frameReady 자가 재발화가 불가능하므로 재수립으로 복구한다.
  // 폭을 아는 곳은 페이지 DOM뿐이라 pending이 아니라 device.state.width를 인자로 쓴다.
  let deviceTree: string[] = [];
  try {
    ({ deviceTree } = await sendBg<{ all: string[]; deviceTree: string[] }>({
      type: "device.documents",
      tabId,
    }));
  } catch {
    return;
  }
  if (deviceTree.length > 0 || snap().tabId !== tabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await reestablish(tabId, state.width, tab?.url ?? "");
}

/** 훅이 마운트마다 부른다. refcount라 마지막 구독자가 사라질 때만 watch를 끊는다. */
export function attachDeviceViewport(tabId: number): () => void {
  subscribers += 1;
  if (snap().tabId !== tabId) {
    set({ tabId, width: null, availableWidth: null, busy: false, expiredByHandoff: false });
  }
  if (!listening) {
    listening = true;
    chrome.runtime.onMessage.addListener(handleMessage);
    void deviceWatch(tabId, true);
    void syncFromPage(tabId);
  }
  return () => {
    subscribers -= 1;
    if (subscribers > 0) return;
    listening = false;
    chrome.runtime.onMessage.removeListener(handleMessage);
    void deviceWatch(tabId, false);
  };
}

/* ── 다이얼로그 응답 ────────────────────────────────────────── */

export function confirmDeviceWarning(): void {
  const { tabId, warningWidth } = snap();
  set({ warningWidth: null });
  useSettingsUiStore.getState().setDeviceModeWarned(true);
  if (tabId == null || warningWidth == null) return;
  void runOffToOn(tabId, warningWidth);
}

export function dismissDeviceWarning(): void {
  set({ warningWidth: null });
}

export function dismissDeviceLoopWarning(): void {
  const tabId = snap().tabId;
  set({ loopWarning: false });
  if (tabId != null) resetLoopGuard(tabId);
  useEditorStore.getState().reset();
}
