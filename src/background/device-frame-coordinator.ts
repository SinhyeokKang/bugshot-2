import { deviceFrameKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import type { BgInternalMessage, DeviceDocumentsResponse } from "@/types/messages";
import type { PickerMessage } from "@/types/picker";

export interface DeviceFrameBinding {
  frameId: number;
  documentId: string;
}

/**
 * storage.session에 실리는 형태. **`topUrl`이 binding과 같은 레코드에 있어야 한다** —
 * SW가 죽으면 arm 슬롯은 통째로 사라지는데 binding만 되살리면 `topUrl`이 `""`이고
 * `isSameOrigin(url, "")`은 `new URL("")`이 throw해 항상 `false`다. 그러면 복원된 래퍼의
 * **첫 same-origin 이동이 통째로 handoff로 오판**돼 top 탭이 강제 이동하고 로그가 지워진다.
 */
interface DeviceFrameRecord extends DeviceFrameBinding {
  topUrl: string;
}

export interface DeviceFrameState {
  /** 판정 기준 URL. 래퍼는 언제나 top과 same-origin이라는 불변식의 대조 대상이다. */
  topUrl: string;
  /** 래퍼 커밋 감시창이 열려 있는가. 잠정 등록과 진입 판정이 이 창 안에서만 일어난다. */
  armed: boolean;
  /**
   * 즉시 redirect돼 device.frameReady가 안 오는 사이트에서 래퍼 frameId를 아는 유일한
   * 시작점 — 성공·차단·handoff 세 판정의 공통 타깃이다.
   */
  provisionalFrameId: number | null;
  binding: DeviceFrameBinding | null;
}

export type DeviceSignal =
  | { kind: "frameReady"; frameId: number; documentId: string }
  | { kind: "beforeNavigate"; frameId: number; parentFrameId: number; url: string }
  | { kind: "committed"; frameId: number; documentId: string; url: string }
  | { kind: "errorOccurred"; frameId: number; url: string }
  // CSP `frame-src`가 삽입 자체를 막으면 webNavigation 이벤트가 하나도 오지 않는다 —
  // 그 경우의 유일한 신호가 이 타임아웃이다. top의 iframe "load"를 보조 신호로 쓰는 안은
  // 폐기했다: 브라우저가 초기 about:blank에도 load를 쏘는 타이밍이 있어, 정상 사이트에서
  // 그걸 차단으로 오판해 모드가 간헐적으로 안 서는 대가가 3초 단축보다 훨씬 컸다.
  | { kind: "armTimeout" };

export type DevicePush =
  | { type: "frameLoaded" }
  | { type: "frameBlocked" }
  | { type: "handoff"; url: string };

export interface DeviceDecision {
  push: DevicePush | null;
  next: DeviceFrameState;
}

const ARM_WINDOW_MS = 3000;

// 판정 기준은 site가 아니라 origin이다 — a.com → www.a.com은 same-site여도 frameElement가
// null이 되고 pre-arm 플래그(origin 스코프 sessionStorage)가 갈려, same-origin 전제로 싸게
// 만든 배선 셋(래퍼 자가 식별·pre-arm 버퍼링·element 컨텍스트 확장)이 한꺼번에 무너진다.
function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function targetFrameId(state: DeviceFrameState): number | null {
  return state.binding?.frameId ?? state.provisionalFrameId;
}

/**
 * 신호 하나 → push 0 또는 1. 성공·차단·handoff가 절대 경쟁하지 않게 이 함수가 유일한 판정처다.
 * content가 contentDocument.location.href를 비교해 스스로 롤백하면 정상 redirect를 차단으로
 * 오판하고, 다른 origin으로 밀린 문서는 DOM으로 들여다볼 수조차 없다.
 */
export function decideDeviceSignal(
  state: DeviceFrameState,
  signal: DeviceSignal,
): DeviceDecision {
  const target = targetFrameId(state);

  switch (signal.kind) {
    case "frameReady": {
      // **이 신호는 신뢰 경계다.** 래퍼 자가식별은 `frameElement.id === DEVICE_FRAME_ID`
      // 하나뿐인데 그 id는 페이지가 붙이는 DOM 속성이고, picker는 all_frames라 페이지가 만든
      // same-origin iframe에도 주입돼 정상적으로 frameReady를 쏜다. 무조건 수용하면 위조
      // binding이 굳고, sentinel 게이트의 모드 판정이 deviceTree 길이라 사용자가 모드를 켠 적
      // 없어도 ON으로 뒤집혀 **진짜 top 문서의 로그가 통째로 안 잡힌다**(에러 없는 은폐).
      // 그래서 이미 래퍼로 아는 프레임이거나, 우리가 연 arm 창의 잠정 래퍼일 때만 받는다.
      if (!state.armed) {
        // frameReady는 한 번만 오지 않는다 — same-origin 불변식 때문에 래퍼 안에서 링크를
        // 타고 들어간 후속 문서도 매번 재발화한다. 그 재발화만 documentId 갱신으로 받는다.
        if (state.binding?.frameId !== signal.frameId) return { push: null, next: state };
        return {
          push: null,
          next: { ...state, binding: { frameId: signal.frameId, documentId: signal.documentId } },
        };
      }
      // 재수립은 살아남은 binding 위에서 arm을 다시 여니 잠정 등록이 없다 — 그때의 타깃은
      // 확정 binding이다. 둘 다 없으면 arm 창 안이어도 받지 않는다(위조 수용 방지).
      const expectedFrameId = state.provisionalFrameId ?? state.binding?.frameId;
      if (expectedFrameId !== signal.frameId) return { push: null, next: state };
      return {
        push: { type: "frameLoaded" },
        next: {
          ...state,
          armed: false,
          provisionalFrameId: null,
          binding: { frameId: signal.frameId, documentId: signal.documentId },
        },
      };
    }

    case "beforeNavigate": {
      if (target != null && signal.frameId === target) {
        // commit에서 잡으면 파티션된 로그아웃 화면이 이미 렌더되고 그 문서의 로그·요청이
        // 수집된 뒤다. 요청 전에 잡는 이 경로가 1차 트리거다.
        if (!isSameOrigin(signal.url, state.topUrl)) {
          return {
            push: { type: "handoff", url: signal.url },
            next: { ...state, armed: false, provisionalFrameId: null, binding: null },
          };
        }
        return { push: null, next: state };
      }
      const canGuess =
        state.armed &&
        state.binding === null &&
        state.provisionalFrameId === null &&
        signal.parentFrameId === 0 &&
        signal.url === state.topUrl;
      if (!canGuess) return { push: null, next: state };
      return { push: null, next: { ...state, provisionalFrameId: signal.frameId } };
    }

    case "committed": {
      if (target == null || signal.frameId !== target) return { push: null, next: state };
      // same-origin URL이 서버에서 302로 cross-origin에 밀린 경우의 폴백.
      if (!isSameOrigin(signal.url, state.topUrl)) {
        return {
          push: { type: "handoff", url: signal.url },
          next: { ...state, armed: false, provisionalFrameId: null, binding: null },
        };
      }
      const binding = { frameId: signal.frameId, documentId: signal.documentId };
      if (!state.armed) return { push: null, next: { ...state, binding } };
      // 경로·쿼리만 바뀐 redirect도 성공이다 — 차단으로 합치지 않는다.
      return {
        push: { type: "frameLoaded" },
        next: { ...state, armed: false, provisionalFrameId: null, binding },
      };
    }

    case "errorOccurred": {
      if (target == null || signal.frameId !== target) return { push: null, next: state };
      if (state.armed) {
        // 잠정 등록을 남기면 arm이 닫힌 뒤에도 그 frameId가 target으로 잡혀, 롤백된 페이지의
        // 같은 프레임 이동이 handoff 경로를 탄다(성공·handoff 분기는 이미 지우고 있다).
        return {
          push: { type: "frameBlocked" },
          next: { ...state, armed: false, provisionalFrameId: null },
        };
      }
      // 감시창 밖 차단(유지 중 XFO 사이트 도달)은 handoff와 같은 경로로 보낸다 — 프레임에
      // 못 들어가는 URL이므로 top을 그리로 내보낸다. 안 하면 백지에 방치된다.
      return {
        push: { type: "handoff", url: signal.url },
        next: { ...state, provisionalFrameId: null, binding: null },
      };
    }

    case "armTimeout":
      if (!state.armed) return { push: null, next: state };
      return {
        push: { type: "frameBlocked" },
        next: { ...state, armed: false, provisionalFrameId: null },
      };

    default:
      signal satisfies never;
      return { push: null, next: state };
  }
}

/**
 * 0 || 래퍼. **동기다** — 소비처가 리스너 최상단이기 때문이고, 대신 호출 전에 복원이 끝나
 * 있음을 탭별 순서 큐가 보장한다. 큐 밖에서 부르면 복원 전 오판이 된다.
 */
export function isTopLikeFrame(
  binding: DeviceFrameBinding | null,
  frameId: number,
): boolean {
  return frameId === 0 || (binding != null && binding.frameId === frameId);
}

/**
 * getAllFrames + binding을 합쳐 **레코더가 붙어 있을 수 있는** document만 전량/래퍼 서브트리로
 * 가른다. manifest에 `match_about_blank`가 없어 about:blank·srcdoc·data: 프레임엔 content
 * script가 안 붙는데, 그런 프레임을 열거에 남기면 stop ACK가 "Receiving end does not exist"로
 * 거절돼 **광고 iframe 하나 때문에 정상 로드된 래퍼까지 롤백된다**.
 */
export function splitTabDocuments(
  frames: Array<{ frameId: number; parentFrameId: number; documentId?: string; url?: string }>,
  binding: DeviceFrameBinding | null,
  opts: { recentBinding?: boolean } = {},
): DeviceDocumentsResponse {
  // 래퍼 자신은 URL 판정에서 면제한다 — 커밋 직후의 getAllFrames가 아직 about:blank를
  // 보고하는 창이 있고, 거기서 떨어뜨리면 deviceTree가 비어 활성화가 실패하며 정상 로드된
  // 래퍼가 롤백된다. binding이 있다는 것 자체가 그 프레임에 스크립트가 살아 있다는 증거다.
  const usable = (f: { frameId: number; documentId?: string; url?: string }) =>
    typeof f.documentId === "string" &&
    f.documentId.length > 0 &&
    (isSupportedUrl(f.url) || f.frameId === binding?.frameId);
  const injectable = frames.filter(usable);
  const all = injectable.map((f) => f.documentId as string);
  if (!binding) return { all, deviceTree: [] };

  const inTree = new Set<number>([binding.frameId]);
  // 계보는 깊이를 모르므로 고정점까지 돈다(프레임 수가 수십 단위라 비용이 무의미하다).
  for (let changed = true; changed; ) {
    changed = false;
    // 계보는 injectable이 아니라 전 프레임으로 돈다 — 중간에 about:blank가 껴도 그 자손이
    // 래퍼 서브트리에서 떨어져 나가면 안 된다.
    for (const f of frames) {
      if (!inTree.has(f.frameId) && inTree.has(f.parentFrameId)) {
        inTree.add(f.frameId);
        changed = true;
      }
    }
  }
  const deviceTree = injectable
    .filter((f) => inTree.has(f.frameId))
    .map((f) => f.documentId as string);
  // getAllFrames가 방금 커밋된 래퍼를 아직 목록에 안 싣는 창이 있다 — 그러면 deviceTree가
  // 통째로 비어 활성화가 실패하고 정상 로드된 래퍼가 롤백된다("가끔 폭을 눌러도 아무 일이
  // 안 일어난다"). binding의 documentId는 커밋·frameReady에서 이미 받은 값이라 그 창에서는
  // 열거를 기다릴 이유가 없다.
  //
  // **단 binding을 방금 확정한 창 안에서만이다.** 무기한 넣으면, 페이지 JS가 래퍼를 지웠는데
  // top 커밋이 없는 경우(binding은 top 커밋에서만 소거된다) 게이트가 영구히 "모드 ON"으로 굳어
  // 죽은 documentId로만 발행한다 = 탭 세션 내내 로그 전면 공백. 창 밖에서는 deviceTree가
  // 비면서 기존 broadcast 폴백으로 자가복구되는 쪽이 맞다.
  //
  // 게이트가 `armed`가 아닌 이유: 판정 성공 분기가 binding과 **같은 전이에서** armed를 false로
  // 떨어뜨리고, 패널도 `arm(false)` 뒤에 열거를 부른다 — 그 조건은 실행 경로에서 참이 될 수 없다.
  const enumerated = frames.some((f) => f.frameId === binding.frameId);
  if (!enumerated && opts.recentBinding && !deviceTree.includes(binding.documentId)) {
    deviceTree.unshift(binding.documentId);
  }
  return { all, deviceTree };
}

/* ── 탭별 상태 · storage 복원 · 순서 큐 ────────────────────────────── */

const bindingByTab = new Map<number, DeviceFrameBinding>();
const armedByTab = new Map<number, { armed: boolean; provisionalFrameId: number | null; topUrl: string }>();
const restoreByTab = new Map<number, Promise<void>>();
const restoredTabs = new Set<number>();
/** binding을 확정한 시각. 커밋 직후 getAllFrames가 래퍼를 아직 안 싣는 창을 덮는 데만 쓴다. */
const bindingConfirmedAt = new Map<number, number>();
const queueByTab = new Map<number, Promise<unknown>>();
const armTimers = new Map<number, ReturnType<typeof setTimeout>>();
// navUrlPromise를 tabId:frameId로 넓히면서 래퍼의 prev URL은 tabs.get이 아니라 직전
// onCommitted URL로 추적해야 한다 — top URL은 래퍼가 움직여도 안 바뀐다.
const lastCommittedUrl = new Map<string, string>();

function ensureRestored(tabId: number): Promise<void> {
  let p = restoreByTab.get(tabId);
  if (p) return p;
  p = chrome.storage.session
    .get(deviceFrameKey(tabId))
    .then((data) => {
      const stored = data[deviceFrameKey(tabId)] as DeviceFrameRecord | undefined;
      if (!stored) return;
      if (!bindingByTab.has(tabId)) {
        bindingByTab.set(tabId, { frameId: stored.frameId, documentId: stored.documentId });
      }
      // 이미 arm이 열려 topUrl을 새로 받았으면 그쪽이 최신이다.
      const slot = armSlot(tabId);
      if (!slot.topUrl) slot.topUrl = stored.topUrl ?? "";
    })
    .catch(() => {})
    .finally(() => {
      restoredTabs.add(tabId);
    });
  restoreByTab.set(tabId, p);
  return p;
}

/**
 * 이 탭에 디바이스 판정이 걸릴 여지가 있는가. **복원 전이면 알 수 없으므로 `true`** —
 * 모른다고 건너뛰면 복원 자체가 영영 안 도는 상태로 굳는다. 관여가 없는 탭의 서브프레임
 * 신호는 `decideDeviceSignal`이 어차피 무발화라, 여기서 접는 것과 결과가 같다.
 */
export function mayNeedDeviceSignal(tabId: number): boolean {
  if (!restoredTabs.has(tabId)) return true;
  if (bindingByTab.has(tabId)) return true;
  const slot = armedByTab.get(tabId);
  return slot?.armed === true || slot?.provisionalFrameId != null;
}

/**
 * 탭별 순서 큐. storage 복구와 각 navigation 처리를 같은 chain에 연결해, 복구 전 이벤트를
 * 동기 기본값으로 판정하지 않게 한다. 즉시성보다 SW 재기동 뒤의 올바른 래퍼 판정이 우선이다.
 */
export function enqueueForTab<T>(tabId: number, task: () => T | Promise<T>): Promise<T> {
  const prev = queueByTab.get(tabId) ?? ensureRestored(tabId);
  const next = prev.then(() => task());
  queueByTab.set(
    tabId,
    next.catch(() => {}),
  );
  return next;
}

export function getDeviceFrame(tabId: number): DeviceFrameBinding | null {
  return bindingByTab.get(tabId) ?? null;
}

export async function setDeviceFrame(
  tabId: number,
  binding: DeviceFrameBinding | null,
): Promise<void> {
  // 권위값은 storage.session이고 Map은 복제 캐시다. 복원을 건너뛰어도 되는 상태가 되므로
  // restore 슬롯을 즉시 resolved로 덮어 다음 큐가 불필요하게 storage를 다시 읽지 않게 한다.
  restoreByTab.set(tabId, Promise.resolve());
  restoredTabs.add(tabId);
  if (binding) {
    bindingByTab.set(tabId, binding);
    bindingConfirmedAt.set(tabId, Date.now());
    const record: DeviceFrameRecord = { ...binding, topUrl: armSlot(tabId).topUrl };
    await chrome.storage.session.set({ [deviceFrameKey(tabId)]: record });
    return;
  }
  // Map은 storage 성공 여부와 무관하게 비운다 — 이 SW 수명에서 죽은 래퍼를 살려두면 로그·
  // navigation 라우팅이 그리로 샌다. storage에 남은 stale은 다음 top 커밋의 clearDeviceFrame이
  // 지우고, 그전에 SW가 죽어 되살아나도 같은 지점이 회수한다.
  bindingByTab.delete(tabId);
  bindingConfirmedAt.delete(tabId);
  await chrome.storage.session.remove(deviceFrameKey(tabId));
}

function armSlot(tabId: number): { armed: boolean; provisionalFrameId: number | null; topUrl: string } {
  let slot = armedByTab.get(tabId);
  if (!slot) {
    slot = { armed: false, provisionalFrameId: null, topUrl: "" };
    armedByTab.set(tabId, slot);
  }
  return slot;
}

function readDeviceState(tabId: number): DeviceFrameState {
  const slot = armSlot(tabId);
  return {
    topUrl: slot.topUrl,
    armed: slot.armed,
    provisionalFrameId: slot.provisionalFrameId,
    binding: getDeviceFrame(tabId),
  };
}

function pushToPanel(message: BgInternalMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

interface HandoffSeams {
  notify?: (expiresAt: number) => Promise<unknown>;
  update?: (tabId: number, url: string) => Promise<unknown>;
  rollback?: (tabId: number) => Promise<unknown>;
  ackTimeoutMs?: number;
}

/**
 * 패널에 준비 기회를 주고 top을 옮긴다. **응답값은 보지 않는다** — 패널이 만료를 알려도
 * cross-origin 문서를 래퍼에 남기지 않는 쪽이 이기고, 폭 강등은 패널이 자기 쪽에서 한다.
 */
export async function handoffDeviceTab(
  tabId: number,
  url: string,
  seams: HandoffSeams = {},
): Promise<void> {
  const {
    notify = (deadline: number) =>
      chrome.runtime.sendMessage({
        type: "device.handoff",
        tabId,
        url,
        expiresAt: deadline,
      } satisfies BgInternalMessage),
    update = (targetTabId: number, targetUrl: string) =>
      chrome.tabs.update(targetTabId, { url: targetUrl }),
    rollback = async (targetTabId: number) => {
      try {
        // width:null 분기는 title을 안 읽지만 payload 계약은 지킨다 — sendMessage 인자가
        // any라 타입이 안 잡아주므로 producer 둘 중 하나만 어긋나도 조용히 남는다.
        await chrome.tabs.sendMessage(
          targetTabId,
          { type: "device.set", width: null, title: "" } satisfies PickerMessage,
          { frameId: 0 },
        );
      } catch {
        await chrome.tabs.reload(targetTabId).catch(() => {});
      }
    },
    ackTimeoutMs = 500,
  } = seams;
  const expiresAt = Date.now() + ackTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      notify(expiresAt),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ackTimeoutMs);
      }),
    ]);
  } catch {
    // 패널이 닫혀도 cross-origin 문서를 래퍼에 남기지 않는다.
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!isSupportedUrl(url)) {
    await rollback(tabId).catch(() => {});
    return;
  }
  await update(tabId, url).catch(() => {});
}

/** 신호를 상태에 반영하고 결과를 사이드패널에 push한다. 반드시 큐 안에서 부른다. */
export async function applyDeviceSignal(
  tabId: number,
  signal: DeviceSignal,
): Promise<DevicePush | null> {
  const { push, next } = decideDeviceSignal(readDeviceState(tabId), signal);
  const slot = armSlot(tabId);
  slot.armed = next.armed;
  slot.provisionalFrameId = next.provisionalFrameId;
  if (next.armed === false) clearArmTimer(tabId);
  const prevBinding = getDeviceFrame(tabId);
  if (
    next.binding &&
    (prevBinding?.frameId !== next.binding.frameId ||
      prevBinding?.documentId !== next.binding.documentId)
  ) {
    // 기록 실패로 여기서 throw하면 아래 판정 push가 통째로 사라지고, 패널은 3초를 헛기다린
    // 끝에 차단으로 접어 **정상 로드된 래퍼를 롤백한다**. Map은 이미 갱신됐다.
    await setDeviceFrame(tabId, next.binding).catch(() => {});
  }
  if (!push) return null;
  if (push.type === "handoff") {
    if (prevBinding) await setDeviceFrame(tabId, null).catch(() => {});
    await handoffDeviceTab(tabId, push.url);
  } else if (push.type === "frameLoaded") {
    // frameId는 방금 확정한 binding에서 나온다 — 사이드패널이 picker.start 재전송에 쓴다.
    pushToPanel({ type: "device.frameLoaded", tabId, frameId: next.binding?.frameId ?? 0 });
  } else {
    pushToPanel({ type: "device.frameBlocked", tabId });
  }
  return push;
}

function clearArmTimer(tabId: number): void {
  const timer = armTimers.get(tabId);
  if (timer == null) return;
  clearTimeout(timer);
  armTimers.delete(tabId);
}

/** 래퍼 커밋 감시창(3s) 개폐. device.set보다 먼저 열어야 첫 onBeforeNavigate를 안 놓친다. */
export function armDeviceFrame(tabId: number, on: boolean, topUrl: string): void {
  clearArmTimer(tabId);
  const slot = armSlot(tabId);
  slot.armed = on;
  slot.provisionalFrameId = null;
  if (topUrl) slot.topUrl = topUrl;
  if (!on) return;
  armTimers.set(
    tabId,
    setTimeout(() => {
      armTimers.delete(tabId);
      void enqueueForTab(tabId, () => applyDeviceSignal(tabId, { kind: "armTimeout" }));
    }, ARM_WINDOW_MS),
  );
}

/** device.documents의 구현. sentinel 게이트의 유일한 문서 열거원이다. */
export async function listTabDocuments(tabId: number): Promise<DeviceDocumentsResponse> {
  return enqueueForTab(tabId, async () => {
    // **실패를 빈 열거로 접지 않는다.** 사이드패널은 열거 실패를 `null`로 구분해 fail-closed
    // 하도록 설계돼 있는데(`picker-control.ts:fetchDeviceTree`), 유일한 열거원이 `[]`로 답하면
    // "모드 OFF"로 읽혀 sentinel이 broadcast되고 숨겨진 top 레코더가 되살아난다(로그 2벌,
    // 무증상). throw해야 `sendBg`가 거절돼 그 null 경로를 탄다.
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames) throw new Error("device.documents: frame enumeration unavailable");
    return splitTabDocuments(
      frames.map((f) => ({
        frameId: f.frameId,
        parentFrameId: f.parentFrameId,
        documentId: f.documentId,
        url: f.url,
      })),
      getDeviceFrame(tabId),
      { recentBinding: Date.now() - (bindingConfirmedAt.get(tabId) ?? 0) < ARM_WINDOW_MS },
    );
  });
}

/** 래퍼가 이동해도 top URL은 안 바뀌므로 프레임별 직전 커밋 URL을 따로 추적한다. */
export function trackCommittedUrl(tabId: number, frameId: number, url: string): string {
  const key = `${tabId}:${frameId}`;
  const prev = lastCommittedUrl.get(key) ?? "";
  lastCommittedUrl.set(key, url);
  return prev;
}

/** top 이동·명시적 OFF에서 Map·storage·타이머를 함께 지운다. 반드시 큐 안에서 부른다. */
export async function clearDeviceFrame(tabId: number): Promise<void> {
  clearArmTimer(tabId);
  armedByTab.delete(tabId);
  for (const key of [...lastCommittedUrl.keys()]) {
    if (key.startsWith(`${tabId}:`)) lastCommittedUrl.delete(key);
  }
  await setDeviceFrame(tabId, null);
}

/**
 * 탭이 사라졌을 때의 정리. 큐 뒤에서 지워야 인플라이트 태스크의 setDeviceFrame이 방금 지운
 * 세션 키를 되살리지 않는다. 큐·복원 슬롯 자체도 함께 버려 SW 수명 동안 누적되지 않게 한다.
 */
export function forgetTab(tabId: number): void {
  void enqueueForTab(tabId, () => clearDeviceFrame(tabId)).finally(() => {
    queueByTab.delete(tabId);
    restoreByTab.delete(tabId);
    restoredTabs.delete(tabId);
  });
}
