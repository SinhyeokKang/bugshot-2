import { deviceFrameKey } from "@/lib/session-keys";
import { isSupportedUrl } from "@/lib/url-support";
import type { BgInternalMessage, DeviceDocumentsResponse } from "@/types/messages";

export interface DeviceFrameBinding {
  frameId: number;
  documentId: string;
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
      const expectedFrameId = state.provisionalFrameId ?? state.binding?.frameId;
      if (expectedFrameId == null || expectedFrameId !== signal.frameId) {
        return { push: null, next: state };
      }
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
        return { push: { type: "frameBlocked" }, next: { ...state, armed: false } };
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
      return { push: { type: "frameBlocked" }, next: { ...state, armed: false } };

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
  opts: { armed?: boolean } = {},
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
  // **단 진입 감시창(armed) 안에서만이다.** 창 밖에서까지 무조건 넣으면, 페이지 JS가 래퍼를
  // 지웠는데 top 커밋이 없는 경우(binding은 top 커밋에서만 소거된다) 게이트가 영구히 "모드 ON"
  // 으로 굳어 죽은 documentId로만 발행한다 = 탭 세션 내내 로그 전면 공백. 창 밖에서는
  // deviceTree가 비면서 기존 broadcast 폴백으로 자가복구되는 쪽이 맞다.
  const enumerated = frames.some((f) => f.frameId === binding.frameId);
  if (!enumerated && opts.armed && !deviceTree.includes(binding.documentId)) {
    deviceTree.unshift(binding.documentId);
  }
  return { all, deviceTree };
}

/* ── 탭별 상태 · storage 복원 · 순서 큐 ────────────────────────────── */

const bindingByTab = new Map<number, DeviceFrameBinding>();
const armedByTab = new Map<number, { armed: boolean; provisionalFrameId: number | null; topUrl: string }>();
const restoreByTab = new Map<number, Promise<void>>();
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
      const stored = data[deviceFrameKey(tabId)] as DeviceFrameBinding | undefined;
      if (stored && !bindingByTab.has(tabId)) bindingByTab.set(tabId, stored);
    })
    .catch(() => {});
  restoreByTab.set(tabId, p);
  return p;
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
  if (binding) {
    bindingByTab.set(tabId, binding);
    await chrome.storage.session.set({ [deviceFrameKey(tabId)]: binding });
    return;
  }
  bindingByTab.delete(tabId);
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

export async function handoffDeviceTab(
  tabId: number,
  url: string,
  notify: (expiresAt: number) => Promise<unknown> = (expiresAt) =>
    chrome.runtime.sendMessage({
      type: "device.handoff",
      tabId,
      url,
      expiresAt,
    } satisfies BgInternalMessage),
  update: (tabId: number, url: string) => Promise<unknown> = (targetTabId, targetUrl) =>
    chrome.tabs.update(targetTabId, { url: targetUrl }),
  rollback: (tabId: number) => Promise<unknown> = async (targetTabId) => {
    try {
      await chrome.tabs.sendMessage(
        targetTabId,
        { type: "device.set", width: null },
        { frameId: 0 },
      );
    } catch {
      await chrome.tabs.reload(targetTabId).catch(() => {});
    }
  },
  ackTimeoutMs = 500,
): Promise<void> {
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
    await setDeviceFrame(tabId, next.binding);
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
    let frames: chrome.webNavigation.GetAllFrameResultDetails[] | null = null;
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId });
    } catch {
      frames = null;
    }
    if (!frames) return { all: [], deviceTree: [] };
    return splitTabDocuments(
      frames.map((f) => ({
        frameId: f.frameId,
        parentFrameId: f.parentFrameId,
        documentId: f.documentId,
        url: f.url,
      })),
      getDeviceFrame(tabId),
      { armed: armSlot(tabId).armed },
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
  });
}
