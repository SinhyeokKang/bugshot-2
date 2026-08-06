import { create } from "zustand";
import { toast } from "sonner";
import { t } from "@/i18n";
import { isSupportedUrl } from "@/lib/url-support";
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
  isDeviceModeLocked,
  noteReestablish,
  putPending,
  resetLoopGuard,
  resolveSelectPath,
  takePending,
} from "./lib/device-mode";

/**
 * 디바이스 뷰포트 모드의 오케스트레이션. **모듈 스코프 단일 인스턴스다.**
 *
 * 이유는 수명이다 — 유일한 UI 소비자인 `DeviceViewportBar`는 `hideSubTabs`(styling·drafting·
 * previewing·done)에서 언마운트되는데, **재수립이 가장 필요한 구간이 정확히 거기다**(작성 중
 * handoff). 오케스트레이션을 그 컴포넌트 수명에 매달면 `device.handoff`·`frameCommitted` push가
 * 통째로 드롭돼 "phase 잠금을 우회한다"는 계약이 실행 경로상 도달 불가가 된다. 그래서 push
 * 리스너는 패널 루트(`App.tsx`)가 열고 닫고, 가용 폭 구독(`device.watch`)만 Bar 수명을 따른다.
 *
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

// 전이는 await를 여럿 낀다 — 그 사이 바인딩 탭이 갈리면 남은 단계가 엉뚱한 탭을 건드린다
// (성공한 래퍼를 unmount + reload 시키는 롤백이 대표적이다).
function stillOn(tabId: number): boolean {
  return snap().tabId === tabId;
}

// 진행 중인 전이가 노리는 폭. store의 width는 device.set 응답 전까지 아직 옛 값이라,
// 즉시 cross-origin으로 밀리는 사이트의 handoff가 그 창에 도착하면 폭을 알 길이 없다.
// 소유권 토큰을 함께 둔다 — 겹친 전이에서 먼저 끝난 쪽이 남의 값을 null로 지우지 않게.
let attemptingWidth: number | null = null;
let attemptToken = 0;

function beginAttempt(width: number): number {
  attemptingWidth = width;
  return ++attemptToken;
}

function endAttempt(token: number): void {
  if (attemptToken === token) attemptingWidth = null;
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

/**
 * **판정 push는 대기 등록보다 먼저 도착할 수 있다.** `device.set` 왕복과 래퍼 커밋은 동시에
 * 진행되므로, 캐시된 페이지처럼 커밋이 빠르면 background가 `frameLoaded`를 쏜 뒤에야 이쪽이
 * 기다리기 시작한다. 그때 push를 흘리면 3초를 헛기다린 끝에 차단으로 접어 **정상 로드된
 * 래퍼를 롤백한다** — 사용자에겐 "가끔 폭을 눌러도 아무 일이 안 일어난다"로 보인다.
 * 그래서 대기자가 없을 때 도착한 판정은 버리지 않고 걸어둔다.
 */
let latchedVerdict: Verdict | null = null;

/** 새 전이의 시작점. 앞선 시도의 대기·걸어둔 판정을 함께 버려 결과가 새지 않게 한다. */
function resetVerdict(): void {
  cancelVerdictWait();
  latchedVerdict = null;
}

function cancelVerdictWait(): void {
  const waiter = verdictWaiter;
  if (!waiter) return;
  verdictWaiter = null;
  clearTimeout(waiter.timer);
  // 덮어쓰기만 하면 그 promise가 영영 안 풀려 busy가 굳는다.
  waiter.resolve({ ok: false });
}

/** frameLoaded / frameBlocked 중 하나를 기다린다. 무신호면 차단으로 접는다. */
function waitForVerdict(): Promise<Verdict> {
  if (latchedVerdict) {
    const latched = latchedVerdict;
    latchedVerdict = null;
    return Promise.resolve(latched);
  }
  cancelVerdictWait();
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
  if (!waiter) {
    latchedVerdict = result;
    return;
  }
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
  if (isDeviceViewportLocked() || state.busy) return; // 카운터도 안 건드린다

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
    if (!stillOn(tabId)) return;
    set({ busy: false, width: res?.width ?? null, availableWidth: res?.available.width ?? state.availableWidth });
    return;
  }

  // 폭 갱신은 재로드가 없어 frameReady도 onCommitted도 오지 않는다 — arm·판정 대기·레코더
  // 전환·로그 clear를 붙이면 3초 무신호 → 차단 판정 → 롤백으로 모드가 통째로 풀린다.
  if (path === "resize") {
    set({ busy: true });
    const res = await deviceSet(tabId, width);
    if (!stillOn(tabId)) return;
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
  const token = beginAttempt(width);
  try {
    // 떠나는 페이지 로그 꼬리를 누적기에 밀어넣는다.
    await syncAndSettleLogs(tabId);
    // device.set보다 먼저 열어야 첫 onBeforeNavigate를 안 놓친다.
    await arm(tabId, true);
    // arm이 열린 **직후**에 비운다 — 이 지점과 다음 문장 사이엔 await가 없어 메시지가 끼어들
    // 수 없고, 이 시점 이후의 판정만이 이번 시도의 것이다. arm보다 앞에서 비우면 arm 왕복 중에
    // 도착한 앞 시도의 인플라이트 push가 새 시도의 판정으로 걸린다.
    resetVerdict();
    const res = await deviceSet(tabId, width);
    // undefined(전달 실패)와 {ok:false}(마운트 실패)를 구분해서 다뤄야 한다 — ok === false만
    // 보면 send가 실패를 undefined로 삼키므로 전달 실패가 성공으로 샌다.
    if (!res?.ok) {
      await arm(tabId, false);
      if (stillOn(tabId)) await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    if (!stillOn(tabId)) return;
    set({ width: res.width, availableWidth: res.available.width });

    const verdict = await waitForVerdict();
    await arm(tabId, false);
    if (!stillOn(tabId)) return;
    if (!verdict.ok) {
      // handoff면 top이 이미 옮겨가는 중이라 롤백하지 않는다 — 재수립이 뒤를 잇는다.
      if (!verdict.handoff) await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    const activated = await finishActivation(tabId, verdict.frameId);
    if (!stillOn(tabId)) return;
    putPending(tabId, width);
    // **레코더 재무장 실패는 모드 실패가 아니다.** 래퍼는 정상 로드됐고, 레코더는 다음 inject
    // 트리거(tabs.onUpdated(complete)·visibilitychange·idle 복귀)에서 같은 게이트를 타고 스스로
    // 재무장된다. 여기서 롤백하면 unmount + location.reload()라 **정상 동작 중인 페이지를
    // 새로고침해 스크롤·입력값을 날린다** — 뷰포트를 고른 행위의 무게에 비해 과하다.
    // 롤백은 래퍼가 실제로 못 선 경우(frameBlocked)에만 남긴다.
    if (!activated) toast.warning(t("issue.device.recordersDegraded"));
  } finally {
    endAttempt(token);
    if (stillOn(tabId)) set({ busy: false });
  }
}

/**
 * 재수립. **사용자 조작이 아니라 "이미 벌어진 페이지 사실"에 대한 반응이다.**
 * 호출 지점은 top onCommitted + pending 하나다. handoff·확장 reload 복구는
 * pending을 세팅하고 top commit을 만들기만 하며 직접 부르지 않는다.
 */
async function reestablish(tabId: number, width: number, url: string): Promise<void> {
  // 게이트를 먼저 본다 — 거부된 시도까지 세면 busy가 겹칠 때 루프 임계가 헛되이 오른다.
  // phase는 넘기지 않는다 — 재수립이 phase로 막히지 않는다는 계약이 그 부재로 표현된다.
  const gate = decideReestablish({ unsupported: unsupportedTab, busy: snap().busy });
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
  const token = beginAttempt(width);
  try {
    // 재수립은 syncAndSettleLogs를 안 한다 — 떠나는 문서가 이미 없다. 1회 경고도 안 띄운다.
    await arm(tabId, true);
    resetVerdict();
    const res = await deviceSet(tabId, width);
    if (!res?.ok) {
      await arm(tabId, false);
      if (stillOn(tabId)) await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    if (!stillOn(tabId)) return;
    set({ width: res.width, availableWidth: res.available.width });

    const loaded = await waitForVerdict();
    await arm(tabId, false);
    if (!stillOn(tabId)) return;
    if (!loaded.ok) {
      if (!loaded.handoff) await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    // stop ACK 뒤 clear를 무조건 한 번 한다 — background의 logClear는 editor 세션 스냅샷이
    // 있을 때만 발화해서, 패널을 막 열고 첫 로그 전이면 안 돈다. 두 번 비워도 둘 다
    // start ACK 전이라 무해하다.
    const activated = await finishActivation(tabId, loaded.frameId);
    if (!stillOn(tabId)) return;
    putPending(tabId, width);
    // 위와 같은 이유 — 재수립 직후의 reload는 handoff가 만든 이동에 한 번 더 겹친다.
    if (!activated) toast.warning(t("issue.device.recordersDegraded"));
  } finally {
    endAttempt(token);
    if (stillOn(tabId)) set({ busy: false });
  }
}

/* ── push 수신 ─────────────────────────────────────────────── */

// 다이얼로그 마운트 지점이 없는 phase — 통보를 토스트 1개로 갈음한다.
const TOAST_ONLY_PHASES = new Set(["recording", "previewing", "done"]);

async function onHandoff(tabId: number, url: string, expiresAt: number): Promise<boolean> {
  if (Date.now() >= expiresAt) {
    // top 이동은 이미 진행된다. 인플라이트 진입 판정만 handoff로 끝내고 pending은 남기지 않는다.
    settleVerdict({ ok: false, handoff: true });
    return false;
  }
  // handoff는 재수립을 직접 하지 않는다 — pending을 세팅하고 top을 옮기는 것까지가 책임이고,
  // 실제 재수립은 top onCommitted 한 지점이 맡는다.
  const width = snap().width ?? attemptingWidth;
  if (width == null) return true;
  // 래퍼가 data:·about:·blob:로 커밋·에러난 경우까지 top 네비게이션 대상으로 삼지 않는다.
  // handoff 플래그로 끊어야 인플라이트 전이가 자기 롤백을 또 돌지 않는다(이중 reload·토스트 2개).
  if (!isSupportedUrl(url)) {
    settleVerdict({ ok: false, handoff: true });
    return true;
  }
  // 진행 중인 select의 판정 대기를 handoff로 끊는다 — 평범한 실패로 끊으면 그 select가
  // 롤백을 돌려 아래에서 세울 pending을 먼저 지운다.
  settleVerdict({ ok: false, handoff: true });
  // background가 이 push의 ACK를 받은 뒤 top을 이동한다. pending이 commit보다 먼저다.
  putPending(tabId, width);
  const phase = useEditorStore.getState().phase;
  if (TOAST_ONLY_PHASES.has(phase)) {
    toast.info(t("issue.device.handoffToast"));
    return true;
  }
  // phase 판정 없이 무조건 켠다 — 렌더 분기가 non-idle 셋뿐이라 idle에서는 안 뜬다.
  set({ expiredByHandoff: true });
  useEditorStore.setState({ sessionExpired: true });
  return true;
}

function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (value?: unknown) => void,
): boolean | void {
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
    void onHandoff(tabId, msg.url, msg.expiresAt).then((ok) => sendResponse({ ok }));
    return true;
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

function isDeviceViewportLocked(): boolean {
  return isDeviceModeLocked(useEditorStore.getState().phase, unsupportedTab);
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
    // 열거 실패면 엇갈림 여부를 판정할 수 없다 — 재수립을 추측으로 발사하지 않는다.
    return;
  }
  if (deviceTree.length > 0 || !stillOn(tabId)) return;
  // 기존 래퍼를 두고 device.set(같은 폭)을 보내면 폭만 바꾸어 commit이 안 생긴다.
  // pending을 먼저 세우고 Full 복귀로 top commit을 만들어 공용 재수립 경로를 태운다.
  putPending(tabId, state.width);
  const reset = await deviceSet(tabId, null);
  if (!reset?.ok) {
    dropPending(tabId);
    set({ width: null });
  }
}

/**
 * **패널 루트에서 한 번만 부른다.** push 리스너 수명이 곧 재수립 가능 구간이라, 조건부로
 * 렌더되는 컴포넌트에 매달면 작성 중 handoff가 통째로 유실된다.
 */
export function attachDeviceViewport(tabId: number): () => void {
  set({ tabId, width: null, availableWidth: null, busy: false, expiredByHandoff: false });
  // 경계에서도 비운다 — 지금은 waitForVerdict 호출부 둘이 모두 resetVerdict 뒤라 실동작
  // 문제가 없지만, 그 불변식을 "세 번째 호출부도 짝을 기억한다"에 맡기지 않는다.
  resetVerdict();
  chrome.runtime.onMessage.addListener(handleMessage);
  // 만료 다이얼로그가 닫히면 handoff 표시도 함께 내린다 — 안 내리면 handoff 1회 뒤의
  // 평범한 세션 만료까지 계속 디바이스 모드 문구로 뜬다.
  const unsubscribe = useEditorStore.subscribe((state, prev) => {
    if (prev.sessionExpired && !state.sessionExpired) set({ expiredByHandoff: false });
  });
  void syncFromPage(tabId);
  return () => {
    chrome.runtime.onMessage.removeListener(handleMessage);
    resetVerdict();
    unsubscribe();
    dropPending(tabId);
    set({ tabId: null });
  };
}

/**
 * 가용 폭 구독. 세그먼트가 화면에 있을 때만 필요하므로 Bar 수명을 따른다 — 모드를 안 쓰는
 * 탭에서 페이지 resize마다 push가 오는 것을 막는다. refcount인 이유는 구독자가 늘어날 여지가
 * 아니라, 리마운트에서 unmount(새)→mount(옛) 순서가 뒤집혀도 watch가 안 끊기게 하려는 것이다.
 */
export function watchAvailableWidth(tabId: number): () => void {
  subscribers += 1;
  if (subscribers === 1) void deviceWatch(tabId, true);
  return () => {
    subscribers -= 1;
    if (subscribers === 0) void deviceWatch(tabId, false);
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
