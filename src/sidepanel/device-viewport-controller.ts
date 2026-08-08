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
  type ActivateResult,
  deviceSet,
  deviceState,
  deviceWatch,
  fetchDeviceTree,
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
  /** 진행 중 전이가 노리는 폭. store의 width는 응답 전까지 옛 값이라 스피너가 떠나는 쪽에 뜬다. */
  busyWidth: number | null;
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
  busyWidth: null,
  warningWidth: null,
  loopWarning: false,
  expiredByHandoff: false,
}));

const VERDICT_TIMEOUT_MS = 3000;

/**
 * 전이가 이 시간을 넘기면 소유권을 놓고 `busy`를 푼다. 정상 전이는 `device.set` + 래퍼 커밋
 * 판정(최대 3초)까지 합쳐도 한참 아래라, 이 값이 발화하면 그건 페이지가 응답을 안 하는 것이다.
 */
export const TRANSITION_WATCHDOG_MS = 15_000;

const subscribers = new Map<number, number>();
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
/**
 * busy로 거부한 재수립을 이어받을 탭. **거부는 실패가 아닌데 소비자가 top 커밋 하나뿐이라**,
 * 거부를 유발한 그 커밋이 이미 지나가서 되돌려놓은 pending을 아무도 집지 않는다 —
 * 래퍼는 top 재로드로 사라졌는데 store width만 남는 desync가 그대로 굳는다.
 */
let deferredTabId: number | null = null;

function beginAttempt(width: number): number {
  attemptingWidth = width;
  return ++attemptToken;
}

function endAttempt(token: number): void {
  if (attemptToken === token) attemptingWidth = null;
}

/**
 * 진행 중인 전이의 소유권을 뺏는다. handoff 만료 강등이 `await deviceSet` 창 안에 도착하면
 * 그 응답의 `set({ width })`가 방금 내린 폭을 되살려 desync가 그대로 복구된다.
 */
function abortAttempt(): void {
  attemptToken += 1;
  attemptingWidth = null;
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

/**
 * 페이지 쪽 Full 복귀를 background가 이미 소유한 경로에서 **패널 상태만** 맞춘다.
 * 폭을 안 내리면 페이지는 Full인데 UI만 ON인 desync가 굳고(같은 폭 재선택은 noop, 페이지
 * 전체 캡처는 영구 차단), 소유권을 안 뺏으면 인플라이트 전이가 그 폭을 되살린다.
 */
function demoteToFull(tabId: number): void {
  abortAttempt();
  dropPending(tabId);
  set({ width: null });
}

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
async function finishActivation(tabId: number, frameId: number): Promise<ActivateResult> {
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

  // 버튼이 이미 막지만 오케스트레이터 쪽 이중 방어 — Radix는 aria-disabled를 동작 가드로
  // 해석하지 않으므로 키보드 활성화가 여기까지 샐 수 있다.
  if (width != null && !isPresetAvailable(width, state.availableWidth)) return;

  const path = resolveSelectPath(state.width, width);
  if (path === "noop") return;

  // OFF→ON 최초 진입이면 경고를 먼저 소비한다(다이얼로그 [계속]이 전이를 잇는다).
  // **아래 카운터 리셋보다 앞이다** — 경고를 띄웠다 취소하면 아무 일도 안 일어난 셈이라,
  // 뒤에 두면 그 조작이 frame-busting 그물을 지운다.
  if (path === "off-to-on" && !useSettingsUiStore.getState().deviceModeWarned) {
    set({ warningWidth: width });
    return;
  }

  // 사용자 조작이 "정상 사용 중" 신호다 — **아무 일도 안 하는 조작은 빼고 센다.**
  // 게이트 앞에 두면 미가용 프리셋·같은 폭 재선택이 frame-busting 그물을 지운다.
  resetLoopGuard(tabId);

  // OFF는 unmount + location.reload()인데 그 reload도 top 커밋이라, pending이 남아 있으면
  // 곧바로 재수립이 걸려 OFF↔ON 무한 루프가 된다. 폐기가 device.set보다 앞이어야 한다.
  // (noop을 이미 걸렀으므로 width === null은 곧 on-to-off다.)
  if (path === "on-to-off" || width == null) {
    dropPending(tabId);
    set({ busy: true, busyWidth: null });
    const res = await deviceSet(tabId, null);
    if (!stillOn(tabId)) return;
    // **응답의 width는 읽지 않는다.** OFF의 결과는 정의상 Full이고, 응답값을 채택하면 이 창에
    // 도착한 handoff 강등이 방금 내린 null을 되살릴 여지가 생긴다. 소유권 토큰 대신 이쪽이
    // 맞다 — off는 노릴 폭이 없어서 토큰에 실을 값 자체가 없다.
    set({ busy: false, busyWidth: null, width: null, availableWidth: res?.available.width ?? state.availableWidth });
    // **OFF는 이어받지 않는다.** 이 경로는 device.set보다 먼저 dropPending을 하므로, drain이
    // 집을 수 있는 건 그 뒤 await 창에서 handoff가 새로 세운 pending(= 방금 끈 폭)뿐이다.
    // 그걸 이어받으면 `전체`를 누른 직후 모드가 그 폭으로 되살아난다. 슬롯만 버린다.
    dropDeferredReestablish(tabId);
    dropPending(tabId);
    return;
  }

  // 폭 갱신은 재로드가 없어 frameReady도 onCommitted도 오지 않는다 — arm·판정 대기·레코더
  // 전환·로그 clear를 붙이면 3초 무신호 → 차단 판정 → 롤백으로 모드가 통째로 풀린다.
  if (path === "resize") {
    set({ busy: true, busyWidth: width });
    const token = beginAttempt(width);
    try {
      const res = await deviceSet(tabId, width);
      if (!stillOn(tabId)) return;
      // 강등·handoff가 이 창 안에 왔으면 그쪽이 이긴다 — 아래 set/putPending이 방금 내린 폭을
      // 되살리거나, 롤백의 dropPending이 handoff가 세운 pending을 지우면 재수립이 미발사된다.
      if (attemptToken !== token) return;
      if (!res?.ok) {
        // **busy는 롤백 뒤에 놓는다**(finally). 앞에서 놓으면 롤백 왕복 내내 게이트가 열려,
        // 그 창에 다른 폭을 고르면 뒤늦은 `set({width:null})`이 그걸 덮어 "페이지는 ON인데
        // UI는 전체"가 굳고 살아남은 pending이 다음 top 커밋에서 조용히 되살아난다.
        await rollbackToFull(tabId, t("issue.device.blocked"));
        return;
      }
      set({ width: res.width, availableWidth: res.available.width });
      putPending(tabId, width);
    } finally {
      const owned = attemptToken === token;
      // 조기 반환(탭 재바인딩·강등)에서도 반납해야 attemptingWidth에 옛 폭이 남지 않는다.
      endAttempt(token);
      // **`stillOn` 안에서만 놓는다** — 탭이 갈렸으면 이 busy는 새 탭 전이의 것이라,
      // 무조건 놓으면 남의 래치를 풀어 게이트가 그 전이 중에 열린다.
      if (stillOn(tabId)) {
        set({ busy: false, busyWidth: null });
        // **busy를 놓는 모든 경로가 drain해야 한다.** 한 경로라도 빠지면 그 전이 중에 거부된
        // 재수립은 아무도 안 집고, 남은 슬롯이 다음 성공 전이의 finally에서 뒤늦게 터진다.
        if (owned) drainDeferredReestablish(tabId);
      }
    }
    return;
  }

  await runTransition(tabId, width, { syncLogs: true });
}

/**
 * OFF→ON과 재수립의 공통 본체. 둘의 실차이는 **떠나는 문서의 로그 꼬리를 밀어넣는지** 하나다
 * (재수립은 그 문서가 이미 없다). 따로 두면 소유권 토큰·롤백 조건 같은 가드가 한쪽만 고쳐지는
 * 비대칭이 반복해서 생긴다 — 실제로 resize 경로가 그렇게 샜다.
 *
 * 진입 게이트(`decideReestablish`·루프 카운터·1회 경고)는 여기가 아니라 호출부가 소유한다.
 */
async function runTransition(
  tabId: number,
  width: number,
  { syncLogs, reestablishing = false }: { syncLogs: boolean; reestablishing?: boolean },
): Promise<void> {
  set({ busy: true, busyWidth: width });
  const token = beginAttempt(width);
  // **상한은 메시지가 아니라 전이에 건다.** `chrome.tabs.sendMessage`엔 타임아웃이 없고 content
  // 리스너는 페이지 메인 스레드에서 디스패치되므로, 대상 탭이 `alert()`·동기 무한루프에 걸리면
  // (BugShot이 겨냥하는 바로 그 페이지) 응답이 영영 안 와 이 함수가 `finally`에 못 닿는다 —
  // `busy`가 굳어 세그먼트가 그 패널 세션 내내 잠긴다.
  //
  // 왕복 하나하나에 상한을 걸어 `undefined`를 만들어내는 안은 폐기했다. 컨트롤러는 그 값을
  // "차단"(→ 롤백 + 오탐 토스트 + 페이지 새로고침)과 "래퍼 없음"(→ 페이지 전체 캡처 잠금 해제,
  // 재수립 전제 확인 무력화)으로 읽으므로, 느린 페이지에서 **모르는 것을 아는 것처럼** 답하게
  // 된다. 게다가 `ensureContentScript`의 첫 문장이 상한 없는 ping이라 정작 정지 페이지는 그
  // 상한에 닿지도 못한다.
  //
  // 대신 소유권만 내려놓는다 — 늦게 깨어난 왕복은 `attemptToken !== token`에 걸려 페이지·스토어를
  // 아무것도 건드리지 않고 끝난다. 이미 있는 기제라 새 실패 모드를 만들지 않는다.
  const watchdog = setTimeout(() => {
    if (attemptToken !== token) return;
    abortAttempt();
    if (stillOn(tabId)) set({ busy: false, busyWidth: null });
  }, TRANSITION_WATCHDOG_MS);
  try {
    // **전제 확인은 래치 *안*이다.** `reestablish` 쪽에 두면 게이트(busy 읽기)와 래치 사이에
    // 소유권 없는 await가 생겨, 그 창에서 사용자 전이가 시작돼 전이 둘이 동시에 돌고 그 창에
    // 도착한 강등(`demoteToFull`의 `abortAttempt`)도 되돌려진다.
    if (reestablishing) {
      const page = await deviceState(tabId);
      if (!stillOn(tabId) || attemptToken !== token) return;
      if (page?.width === width) {
        // 이미 그 폭이다 — `device.set`을 또 보내면 노드를 유지한 채 폭만 갱신하므로 재로드가
        // 없고, 무신호 → armTimeout → 롤백으로 정상 모드가 스스로 꺼진다. 상태만 맞춘다.
        set({ width, availableWidth: page.available.width });
        putPending(tabId, width);
        return;
      }
      // 아무 일도 안 하고 끝나는 시도는 세지 않는다 — 그래서 카운터가 전제 확인 뒤다.
      if (noteReestablish(tabId) === "loop") {
        dropPending(tabId);
        set({ width: null, loopWarning: true });
        return;
      }
    }
    // 떠나는 페이지 로그 꼬리를 누적기에 밀어넣는다.
    if (syncLogs) await syncAndSettleLogs(tabId);
    // device.set보다 먼저 열어야 첫 onBeforeNavigate를 안 놓친다.
    await arm(tabId, true);
    // arm이 열린 **직후**에 비운다 — 이 지점과 다음 문장 사이엔 await가 없어 메시지가 끼어들
    // 수 없고, 이 시점 이후의 판정만이 이번 시도의 것이다. arm보다 앞에서 비우면 arm 왕복 중에
    // 도착한 앞 시도의 인플라이트 push가 새 시도의 판정으로 걸린다.
    resetVerdict();
    const res = await deviceSet(tabId, width);
    // 이 창 안에서 handoff 만료 강등이 왔으면 그쪽이 이긴다 — 아래 set({width})가 방금 내린
    // 폭을 되살리면 "래퍼는 없는데 UI만 ON"이 그대로 돌아온다.
    // **토큰을 잃었으면 arm은 건드리지 않는다** — 감시창은 탭당 슬롯 하나에 토큰이 없어서,
    // 진 전이가 닫으면 이긴 전이의 `frameLoaded`가 유실돼 3초 침묵 뒤 롤백된다.
    if (attemptToken !== token) return;
    // undefined(전달 실패)와 {ok:false}(마운트 실패)를 구분해서 다뤄야 한다 — ok === false만
    // 보면 send가 실패를 undefined로 삼키므로 전달 실패가 성공으로 샌다.
    if (!res?.ok) {
      await arm(tabId, false);
      if (stillOn(tabId)) await rollbackToFull(tabId, t("issue.device.blocked"));
      return;
    }
    if (!stillOn(tabId)) {
      await arm(tabId, false);
      return;
    }
    set({ width: res.width, availableWidth: res.available.width });

    const verdict = await waitForVerdict();
    await arm(tabId, false);
    if (!stillOn(tabId)) return;
    if (!verdict.ok) {
      // handoff면 top이 이미 옮겨가는 중이라 롤백하지 않는다 — 재수립이 뒤를 잇는다.
      // arm(false) 왕복 중에 온 handoff도 마찬가지다: 그쪽이 세운 pending을 이 롤백의
      // dropPending이 지우면 재수립이 통째로 미발사된다.
      if (!verdict.handoff && attemptToken === token) {
        await rollbackToFull(tabId, t("issue.device.blocked"));
      }
      return;
    }
    // stop ACK 뒤 clear를 무조건 한 번 한다 — background의 logClear는 editor 세션 스냅샷이
    // 있을 때만 발화해서, 패널을 막 열고 첫 로그 전이면 안 돈다. 두 번 비워도 둘 다
    // start ACK 전이라 무해하다.
    const activated = await finishActivation(tabId, verdict.frameId);
    // finishActivation은 백그라운드 왕복·ACK 재시도라 수백 ms다 — 그 창에서 온 만료 강등이
    // 이겨야 한다. 안 그러면 아래 putPending이 방금 버린 pending을 되살려 재수립이 돈다.
    if (!stillOn(tabId) || attemptToken !== token) return;
    putPending(tabId, width);
    // **레코더 재무장 실패는 모드 실패가 아니다.** 래퍼는 정상 로드됐고, 레코더는 다음 inject
    // 트리거(tabs.onUpdated(complete)·visibilitychange·idle 복귀)에서 같은 게이트를 타고 스스로
    // 재무장된다. 여기서 롤백하면 unmount + location.reload()라 **정상 동작 중인 페이지를
    // 새로고침해 스크롤·입력값을 날린다** — 뷰포트를 고른 행위의 무게에 비해 과하다.
    // 롤백은 래퍼가 실제로 못 선 경우(frameBlocked)에만 남긴다.
    // 자동 복구를 약속하는 문구는 start ACK 실패에만 참이다 — stop ACK에 닿지도 못한
    // 갈래는 숨은 top이 무장된 채 남아 로그가 2벌이 되고, 그건 스스로 안 낫는다.
    if (activated === "startFailed") toast.warning(t("issue.device.recordersDegraded"));
    if (activated === "notReached") toast.warning(t("issue.device.recordersStuck"));
  } finally {
    clearTimeout(watchdog);
    const owned = attemptToken === token;
    endAttempt(token);
    if (stillOn(tabId)) {
      set({ busy: false, busyWidth: null });
      // 소유권을 잃었으면 이어받지 않는다 — 그 pending은 나를 밀어낸 handoff가 top 커밋용으로
      // 세운 것이라, 여기서 먼저 소비하면 정작 그 커밋에서 재수립이 미발사된다.
      if (owned) drainDeferredReestablish(tabId);
    }
  }
}

/** 이어받기 예약만 버린다 — OFF·detach처럼 "되살리면 안 되는" 종료가 쓴다. */
function dropDeferredReestablish(tabId: number): void {
  if (deferredTabId === tabId) deferredTabId = null;
}

/** busy로 거부돼 되돌려진 재수립을 전이 종료 직후 한 번 이어받는다. */
function drainDeferredReestablish(tabId: number): void {
  if (deferredTabId !== tabId) return;
  deferredTabId = null;
  const width = takePending(tabId);
  if (width == null) return;
  void reestablish(tabId, width).catch(() => {});
}

/**
 * 재수립. **사용자 조작이 아니라 "이미 벌어진 페이지 사실"에 대한 반응이다.**
 * 호출 지점은 top onCommitted와 `drainDeferredReestablish` 둘이다.
 *
 * **전제("래퍼가 없다")를 코드로 확인한다.** 이걸 주석으로만 두면 호출 지점이 늘어날 때마다
 * 조용히 깨진다 — 실제로 이어받기가 생기면서 깨졌다. 래퍼가 이미 그 폭으로 서 있는데
 * `device.set`을 또 보내면 노드를 유지한 채 폭만 갱신하므로 **재로드가 안 생기고**,
 * `frameReady`도 `onCommitted`도 안 와서 무신호 → `armTimeout` → `frameBlocked` → 롤백,
 * 즉 정상 모드가 스스로 꺼지며 페이지를 새로고침한다.
 *
 * 게이트만 소유하고 본체는 `runTransition`에 넘긴다 — 사용자 전이와 다른 건 진입 조건과
 * 로그 꼬리 sync 여부뿐이고, 1회 경고를 안 띄우는 것도 여기서 안 부르는 것으로 표현된다.
 */
async function reestablish(tabId: number, width: number): Promise<void> {
  // 게이트를 먼저 본다 — 거부된 시도까지 세면 busy가 겹칠 때 루프 임계가 헛되이 오른다.
  // phase는 넘기지 않는다 — 재수립이 phase로 막히지 않는다는 계약이 그 부재로 표현된다.
  const gate = decideReestablish({ unsupported: unsupportedTab, busy: snap().busy });
  if (gate.action === "reject") {
    // busy 거부는 실패가 아니다 — 되돌려놓지 않으면 select()가 도는 중에 온 top 커밋에서
    // 모드가 조용히 유실된다. 되돌리는 것만으론 부족해 이어받기까지 예약한다.
    putPending(tabId, width);
    deferredTabId = tabId;
    return;
  }
  if (gate.action === "abandon") {
    dropPending(tabId);
    set({ width: null });
    return;
  }
  // 재수립은 syncAndSettleLogs를 안 한다 — 떠나는 문서가 이미 없다. 전제 확인·루프 카운터는
  // `runTransition`이 래치 안에서 소유한다(게이트와 래치 사이에 창을 만들지 않으려고).
  // 가용 폭은 재확인하지 않는다 — 사용자 조작이 아니라 페이지 사실에 대한 반응이라,
  // 안 들어가는 폭이면 창이 좁아진 것이고 그건 다음 `availableChanged`가 정정한다.
  await runTransition(tabId, width, { syncLogs: false, reestablishing: true });
}

/* ── push 수신 ─────────────────────────────────────────────── */

/**
 * 만료 다이얼로그를 **실제로 렌더하는** phase. 나머지는 토스트 1개로 갈음한다.
 *
 * 화이트리스트여야 한다 — 렌더 지점이 없는 phase(idle·picking·recording·previewing·done)에서
 * `sessionExpired`를 켜면 그 순간 통보는 0건인데 플래그만 **래치**된다(내리는 건 `reset()`뿐).
 * 그 뒤 요소를 골라 styling에 들어가는 즉시 만료 다이얼로그가 떠 방금 만든 선택을 파기하고,
 * 그동안 `useEditorSessionSync`의 저장·복구 경로도 통째로 멈춘다.
 * 마운트 지점은 `IssueTab`의 capturing·drafting·styling 세 분기다.
 */
const DIALOG_PHASES = new Set(["capturing", "drafting", "styling"]);

/**
 * 반환값은 "기한 안에 처리했나"다. background는 그걸 읽지 않고 top을 옮기므로, 기한을 넘겼으면
 * 재수립을 포기하는 대신 **Full로 강등해** 페이지와 UI를 맞추는 것까지가 이쪽 책임이다.
 */
async function onHandoff(tabId: number, url: string, expiresAt: number): Promise<boolean> {
  const inTime = Date.now() < expiresAt;
  // handoff는 재수립을 직접 하지 않는다 — pending을 세팅하고 top을 옮기는 것까지가 책임이고,
  // 실제 재수립은 top onCommitted 한 지점이 맡는다.
  // 진행 중인 select의 판정 대기를 handoff로 끊는다 — 평범한 실패로 끊으면 그 select가
  // 롤백을 돌려 아래에서 세울 pending을 먼저 지운다.
  settleVerdict({ ok: false, handoff: true });
  // **진행 중 전이가 노리는 폭이 우선이다** — store의 width는 응답 전까지 옛 값이라,
  // resize 중 handoff면 사용자가 방금 고른 폭이 아니라 떠나는 폭을 나르게 된다.
  const width = attemptingWidth ?? snap().width;
  if (width == null) return inTime;
  // 래퍼가 data:·about:·blob:로 커밋·에러난 경우까지 top 네비게이션 대상으로 삼지 않는다.
  // background가 래퍼 제거 + reload로 접으므로 device.set을 또 부르지 않는다(이중 reload) —
  // 대신 폭은 이쪽이 내린다. 안 내리면 페이지는 Full인데 UI만 ON으로 남는다.
  if (!isSupportedUrl(url)) {
    demoteToFull(tabId);
    toast.error(t("issue.device.blocked"));
    return inTime;
  }

  if (inTime) {
    // background가 이 push의 ACK를 받은 뒤 top을 이동한다. pending이 commit보다 먼저다.
    putPending(tabId, width);
    // **인플라이트 전이의 소유권도 뺏는다.** 안 뺏으면 그 전이의 롤백이 방금 세운 pending을
    // 지워 재수립이 통째로 미발사되고, 실제로는 handoff인데 "차단됨" 오탐이 뜬다.
    // (만료·미지원 갈래는 demoteToFull이 이미 abortAttempt를 한다.)
    abortAttempt();
  } else {
    demoteToFull(tabId);
  }
  // top이 실제로 옮겨가는 건 기한과 무관하다 — 통보는 양쪽 경로가 같아야 한다.
  const phase = useEditorStore.getState().phase;
  if (!DIALOG_PHASES.has(phase) || trimmingOverlay || !issueTabMounted) {
    toast.info(t("issue.device.handoffToast"));
    return inTime;
  }
  set({ expiredByHandoff: true });
  useEditorStore.setState({ sessionExpired: true });
  return inTime;
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
    void onHandoff(tabId, msg.url, msg.expiresAt)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === "frameCommitted") {
    if (msg.tabId !== tabId || msg.frameId !== 0) return;
    // 가용 폭 리스너는 **top 문서에 붙는다** — top이 갈리면 사라지는데 `deviceWatch`는
    // refcount 0→1에서만 나가므로 재전송 지점이 없다. 그러면 `전체`로 되돌린 뒤 창·패널 폭을
    // 바꿔도 `availableWidth`가 그 패널 세션 내내 고정돼, 안 들어가는 폭이 활성으로 보인다.
    if (subscribers.get(tabId)) syncDeviceWatch(tabId, true);
    // 소비 즉시 삭제한 뒤 재수립하고, 성공하면 다시 세팅한다(실패 경로에 유령 pending이 안 남게).
    const width = takePending(tabId);
    if (width == null) return;
    // 이전엔 chrome.tabs.get 체인의 catch가 rejection을 덮고 있었다 — 그 봉인을 유지한다.
    void reestablish(tabId, width).catch(() => {});
  }
}

/* ── 구독 ──────────────────────────────────────────────────── */

// 미지원 판정은 훅이 알려준다 — 컨트롤러가 chrome.tabs를 또 폴링하지 않는다.
let unsupportedTab = false;

/**
 * 만료 다이얼로그가 **지금 실제로 마운트될 수 있는가**의 두 번째 축. phase가 drafting이어도
 * 트림 오버레이가 떠 있으면 `IssueTab`이 다이얼로그를 렌더하지 않는다 — phase만 보면 통보가
 * 0건인데 `sessionExpired`만 래치돼 세션 저장이 멈춘다.
 */
let trimmingOverlay = false;

export function setDeviceViewportTrimming(value: boolean): void {
  trimmingOverlay = value;
}

/**
 * 세 번째 축이자 **가장 정확한 축** — `IssueTab`이 지금 트리에 있는가. 다이얼로그의 마운트
 * 지점이 거기뿐이므로 그 컴포넌트 자신이 보고한다.
 *
 * phase만으로는 못 잡는다: `capturing`은 콘솔·네트워크 서브탭이 열려 있는 phase인데
 * (`hideSubTabs`에도 `logTabsLocked`에도 없다) 서브탭을 켜면 Radix `TabsContent`가
 * `IssueTab`을 언마운트한다. 숨는 조건을 컨트롤러가 다시 열거하면 다음 서브탭·오버레이가
 * 생길 때마다 같은 구멍이 다시 난다 — 마운트 사실을 그대로 받는다.
 */
let issueTabMounted = false;

export function setDeviceViewportIssueMounted(value: boolean): void {
  issueTabMounted = value;
}

export function setDeviceViewportUnsupported(value: boolean): void {
  unsupportedTab = value;
  if (!value) return;
  const tabId = snap().tabId;
  if (tabId == null) return;
  // pending만 버리면 안 된다 — 폭을 안 내리면 "래퍼는 없는데 UI만 ON"이 굳는다.
  // `reestablish`의 abandon 분기가 내려주길 기대할 수 없다: 그건 pending이 살아 있어야
  // 도달하는데, 미지원 판정은 `status:"loading"`에서도 돌아 top 커밋보다 먼저 올 수 있다.
  demoteToFull(tabId);
  // 대기 중이던 진입 경고도 함께 내린다 — Bar가 null을 반환해 다이얼로그는 언마운트되지만
  // 플래그는 래치돼, 같은 탭이 지원 URL로 돌아오면 조작 없이 경고가 되살아난다.
  set({ warningWidth: null });
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
  // 열거 실패(null)면 엇갈림 여부를 판정할 수 없다 — 아래 복구가 정상 페이지를 reload하므로
  // 추측으로 발사하지 않는다. 재시도·in-flight 병합·null 세만틱은 공용 경로가 소유한다.
  const deviceTree = await fetchDeviceTree(tabId);
  if (deviceTree == null || !stillOn(tabId)) return;
  if (deviceTree.length > 0) {
    // 래퍼도 binding도 정상이다 — 여기서 pending을 안 세우면 이 패널 문서가 아는 폭이
    // 아무 데도 안 남아, 다음 top 커밋에서 재수립이 미발사되고 래퍼만 사라진다.
    // (pending은 인메모리라 패널을 닫았다 열면 select()가 세운 값이 이미 없다.)
    //
    // **다시 읽고 쓴다** — 여기까지 두 번의 왕복(device.state → device.documents+재시도)을
    // 거치는 동안 사용자가 `전체`를 눌렀으면 그쪽이 이미 dropPending을 했고, 옛 폭으로
    // 되살리면 이어지는 reload의 top 커밋이 그걸 소비해 방금 끈 모드가 다시 켜진다.
    if (snap().width === state.width) putPending(tabId, state.width);
    return;
  }
  // 조회 두 왕복 사이에 사용자가 `전체`를 눌렀으면 그쪽이 이미 폐기했다 — 되살리면
  // OFF의 reload 커밋이 그걸 소비해 방금 끈 모드가 부활한다(위 분기와 같은 규율).
  if (snap().width !== state.width) return;
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
  // 경고 두 개도 함께 비운다 — 탭 재바인딩을 넘어 살아남으면 [계속]이 **새 탭 id에 옛 폭**으로
  // 전이를 돌고, 루프 다이얼로그는 그 탭과 무관한 draft를 reset한다.
  set({
    tabId,
    width: null,
    availableWidth: null,
    busy: false,
    busyWidth: null,
    expiredByHandoff: false,
    warningWidth: null,
    loopWarning: false,
  });
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
    // 카운터도 함께 되돌린다 — 남겨두면 다음 부착의 첫 재수립이 앞 세션 잔량 위에서 센다.
    resetLoopGuard(tabId);
    // 이어받기 슬롯도 비운다 — 남기면 다음 부착의 첫 성공 전이가 방금 세운 pending을
    // 그 슬롯에 뺏겨, 이미 선 래퍼에 device.set을 또 보내고 무신호 → armTimeout → 롤백으로
    // **방금 켠 모드가 3초 뒤 스스로 꺼지며 페이지를 새로고침한다.**
    dropDeferredReestablish(tabId);
    set({ tabId: null });
  };
}

/**
 * 가용 폭 구독. 세그먼트가 화면에 있을 때만 필요하므로 Bar 수명을 따른다 — 모드를 안 쓰는
 * 탭에서 페이지 resize마다 push가 오는 것을 막는다. refcount인 이유는 구독자가 늘어날 여지가
 * 아니라, 리마운트에서 unmount(새)→mount(옛) 순서가 뒤집혀도 watch가 안 끊기게 하려는 것이다.
 */
/**
 * watch 상태를 **탭별 직렬 체인**으로 보낸다. 두 호출이 겹치면 각자 `ensureContentScript`
 * (ping 실패 시 최대 ~500ms 폴링)를 앞세우므로 `true`가 길어져 `false`보다 늦게 도착할 수
 * 있고, 그러면 해제 지점이 사라져 페이지에 resize 리스너가 남는다. 보낼 값을 **체인 안에서**
 * 읽으므로 마지막에 등록된 태스크가 언제나 현재 refcount를 반영한다.
 */
const watchChain = new Map<number, Promise<unknown>>();

function syncDeviceWatch(tabId: number, alsoRefresh = false): void {
  const prev = watchChain.get(tabId) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      const on = (subscribers.get(tabId) ?? 0) > 0;
      await deviceWatch(tabId, on);
      // 주입은 앞선 deviceWatch가 이미 보장했다 — 순차로 두면 ping 1회로 끝난다.
      if (on && alsoRefresh) await refreshAvailableWidth(tabId);
    })
    .catch(() => {});
  watchChain.set(tabId, next);
  // 자기가 꼬리일 때만 비운다 — 뒤에 이어 붙은 태스크가 있으면 그 체인을 끊게 된다.
  void next.then(() => {
    if (watchChain.get(tabId) === next) watchChain.delete(tabId);
  });
}

export function watchAvailableWidth(tabId: number): () => void {
  // refcount는 **탭별**이다 — 전역 하나면 탭 재바인딩에서 mount(새 탭)가 unmount(옛 탭)보다
  // 먼저 오는 순서에 카운터가 2→1이 되어 새 탭에 watch가 안 나가고 옛 탭 구독도 안 끊긴다.
  subscribers.set(tabId, (subscribers.get(tabId) ?? 0) + 1);
  if (subscribers.get(tabId) === 1) {
    // 구독이 끊겨 있던 동안의 resize는 push가 안 온다 — 재진입 때 한 번 따라잡지 않으면
    // 안 들어가는 폭이 활성으로 보이고, 누르면 top에 가로 스크롤이 생긴다.
    syncDeviceWatch(tabId, true);
  }
  return () => {
    const next = (subscribers.get(tabId) ?? 1) - 1;
    if (next > 0) {
      subscribers.set(tabId, next);
      return;
    }
    subscribers.delete(tabId);
    syncDeviceWatch(tabId);
  };
}

async function refreshAvailableWidth(tabId: number): Promise<void> {
  const state = await deviceState(tabId);
  if (!stillOn(tabId) || state == null) return;
  set({ availableWidth: state.available.width });
}

/* ── 다이얼로그 응답 ────────────────────────────────────────── */

export function confirmDeviceWarning(): void {
  const { tabId, warningWidth, busy, availableWidth } = snap();
  set({ warningWidth: null });
  useSettingsUiStore.getState().setDeviceModeWarned(true);
  if (tabId == null || warningWidth == null) return;
  // 다이얼로그 왕복 사이에 phase·창 폭이 바뀌었을 수 있다 — select()의 게이트는 이미
  // 지나갔으므로 여기서 한 번 더 본다(잠긴 상태에서 전이가 시작되는 유일한 구멍이었다).
  if (isDeviceViewportLocked() || busy) return;
  if (!isPresetAvailable(warningWidth, availableWidth)) return;
  void runTransition(tabId, warningWidth, { syncLogs: true });
}

export function dismissDeviceWarning(): void {
  set({ warningWidth: null });
}

/**
 * 루프 경고는 "모드를 못 유지한다"는 사실 보고이지 세션 종료 사유가 아니다 — 모드만 `전체`로
 * 되돌리고(폭은 판정 시점에 이미 null) 작성 중이던 제목·본문·캡처는 그대로 둔다. 여기서
 * `useEditorStore.reset()`을 부르면, 재로드가 잦은 페이지에서 사용자가 쓰던 draft가
 * 자기 조작과 무관하게 사라진다.
 */
export function dismissDeviceLoopWarning(): void {
  const tabId = snap().tabId;
  set({ loopWarning: false });
  if (tabId != null) resetLoopGuard(tabId);
}
